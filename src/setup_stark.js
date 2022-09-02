const fs = require("fs");
const path = require("path");
const assert = require("assert");

const F = require("pil-stark").FGL;
const {readR1cs} = require("r1csfile");
const { newConstantPolsArray, compile, getKs } = require("pilcom");
const r1cs2plonk = require("pil-stark").r1cs2plonk;

async function run() {

    const r1csFile = path.join(__dirname, "..", "build", "circuit.r1cs");
    const pilFile = path.join(__dirname, "circuit.pil");
    const constFile = path.join(__dirname, "..", "build", "circuit.const");
    const execFile = path.join(__dirname, "..", "build", "circuit.exec");

    const pil = await compile(F, pilFile);
    const constPols =  newConstantPolsArray(pil);

    const r1cs = await readR1cs(r1csFile, {F: F, logger:console });

    const [plonkConstraints, plonkAdditions] = r1cs2plonk(F, r1cs);
    const customGatesInfo = getCustomGatesInfo(r1cs);

    const nPublics = 1;
    const nPublicRows = 1;

    const NUsed = 256;
    const nBits = 8;
    const N = 1 << nBits;

    const sMap = [];
    for (let i=0;i<3; i++) {
        sMap[i] = new Uint32Array(NUsed);
    }

    let r=0;


    // Paste public inputs.
    for (let i=0; i<nPublicRows; i++) {
        constPols.PlonkCircuit.Qm[r+i] = 0n;
        constPols.PlonkCircuit.Ql[r+i] = 0n;
        constPols.PlonkCircuit.Qr[r+i] = 0n;
        constPols.PlonkCircuit.Qo[r+i] = 0n;
        constPols.PlonkCircuit.Qk[r+i] = 0n;
        constPols.PlonkCircuit.QCountBits[r+i] = 0n;
    }

    for (let i=0; i<nPublics; i++) {
        sMap[0][r+i] = 1+i;
        sMap[1][r+i] = 0;
        sMap[2][r+i] = 0;
    }

    r += nPublicRows;


    // Paste plonk constraints.
    const partialRows = {};
    for (let i=0; i<plonkConstraints.length; i++) {
        if ((i%10000) == 0) console.log(`Processing constraint... ${i}/${plonkConstraints.length}`);
        const c = plonkConstraints[i];
        constPols.PlonkCircuit.Qm[r] = c[3];
        constPols.PlonkCircuit.Ql[r] = c[4];
        constPols.PlonkCircuit.Qr[r] = c[5];
        constPols.PlonkCircuit.Qo[r] = c[6];
        constPols.PlonkCircuit.Qk[r] = c[7];
        constPols.PlonkCircuit.QCountBits[r] = 0n;
        sMap[0][r] = c[0];
        sMap[1][r] = c[1];
        sMap[2][r] = c[2];
        r ++;
    }


    // Generate Custom Gates
    for (let i=0; i<r1cs.customGatesUses.length; i++) {
        if ((i%10000) == 0) console.log(`Processing custom gates... ${i}/${r1cs.customGatesUses.length}`);
        const cgu = r1cs.customGatesUses[i];
        if (cgu.id == customGatesInfo.CountBitsId) {
            assert(cgu.signals.length == 2);
            sMap[0][r] = cgu.signals[0];
            sMap[1][r] = 0;
            sMap[2][r] = cgu.signals[1];
            constPols.PlonkCircuit.Qm[r] = 0n;
            constPols.PlonkCircuit.Ql[r] = 0n;
            constPols.PlonkCircuit.Qr[r] = 0n;
            constPols.PlonkCircuit.Qo[r] = 0n;
            constPols.PlonkCircuit.Qk[r] = 0n;
            constPols.PlonkCircuit.QCountBits[r] = 1n;
            r+= 1;
        } else {
            assert(0, "Invalid gate id");
        }
    }


    // Calculate S Polynomials
    const ks = getKs(F, 2);
    let w = F.one;
    for (let i=0; i<N; i++) {
        if ((i%10000) == 0) console.log(`Preparing S... ${i}/${N}`);
        constPols.PlonkCircuit.S[0][i] = w;
        for (let j=1; j<3; j++) {
            constPols.PlonkCircuit.S[j][i] = F.mul(w, ks[j-1]);
        }
        w = F.mul(w, F.w[nBits]);
    }

    const lastSignal = {}
    for (let i=0; i<r; i++) {
        if ((i%10000) == 0) console.log(`Connection S... ${i}/${r}`);
        for (let j=0; j<3; j++) {
            if (sMap[j][i]) {
                if (typeof lastSignal[sMap[j][i]] !== "undefined") {
                    const ls = lastSignal[sMap[j][i]];
                    connect(constPols.PlonkCircuit.S[ls.col], ls.row, constPols.PlonkCircuit.S[j], i);
                } else {
                    lastSignal[sMap[j][i]] = {
                        col: j,
                        row: i
                    };
                }
            }
        }
    }


    // Fill unused rows
    while (r<N) {
        if ((r%100000) == 0) console.log(`Empty gates... ${r}/${N}`);
        constPols.PlonkCircuit.Qm[r] = 0n;
        constPols.PlonkCircuit.Ql[r] = 0n;
        constPols.PlonkCircuit.Qr[r] = 0n;
        constPols.PlonkCircuit.Qo[r] = 0n;
        constPols.PlonkCircuit.Qk[r] = 0n;
        constPols.PlonkCircuit.QCountBits[r] = 1n;
        r +=1;
    }

    constPols.Global.L1[0] = 1n;
    for (let i=1; i<N; i++) {
        constPols.Global.L1[i] = 0n;
    }

    for (let i=0; i<N; i++) {
        constPols.PlonkCircuit.kIn[i] = BigInt(i);
        constPols.PlonkCircuit.kOut[i] = BigInt(countBits(i));
    }

    await constPols.saveToFile(constFile);

    await writeExecFile(execFile, plonkAdditions,  sMap);

    console.log("Setup generated");


    function connect(p1, i1, p2, i2) {
        [p1[i1], p2[i2]] = [p2[i2], p1[i1]];
    }

    function countBits(a) {
        let cnt =0;
        while (a) {
            if (a & 1) cnt++;
            a = a >> 1;
        }
        return cnt;
    }
}



run().then(()=> {
    process.exit(0);
}, (err) => {
    console.log(err.message);
    console.log(err.stack);
    process.exit(1);
});


async function writeExecFile(execFile, adds, sMap) {

    const size = 2 + adds.length*4 + sMap.length*sMap[0].length;
    const buff = new BigUint64Array(size);

    buff[0] = BigInt(adds.length);
    buff[1] = BigInt(sMap[0].length);

    for (let i=0; i< adds.length; i++) {
        buff[2 + i*4     ] = BigInt(adds[i][0]);
        buff[2 + i*4 + 1 ] = BigInt(adds[i][1]);
        buff[2 + i*4 + 2 ] = adds[i][2];
        buff[2 + i*4 + 3 ] = adds[i][3];
    }

    for (let i=0; i<sMap[0].length; i++) {
        for (let c=0; c<3; c++) {
            buff[2 + adds.length*4 + 3*i + c] = BigInt(sMap[c][i]);
        }
    }

    const fd =await fs.promises.open(execFile, "w+");
    await fd.write(buff);
    await fd.close();
}


function getCustomGatesInfo(r1cs) {
    let CountBitsId;
    assert(r1cs.customGates.length == 1);
    for (let i=0; i<r1cs.customGates.length; i++) {
        switch (r1cs.customGates[i].templateName) {
            case "CountBits":
                CountBitsId =i;
                assert(r1cs.customGates[0].parameters.length == 0);
                break;
            default:
                throw new Error("Invalid custom gate: " , r1cs.customGates[0].name);
        }
    }
    if (typeof CountBitsId === "undefined") throw new Error("CountBits custom gate not defined");

    const res = {
        CountBitsId: CountBitsId,
        nCountBits: 0,
    }

    for (let i=0; i< r1cs.customGatesUses.length; i++) {
        if (r1cs.customGatesUses[i].id == CountBitsId) {
            res.nCountBits ++;
        } else {
            throw new Error("Custom gate not defined" + r1cs.customGatesUses[i].id);
        }
    }

    return res;
}