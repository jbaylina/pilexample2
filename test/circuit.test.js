const chai = require("chai");
const path = require("path");
const assert = chai.assert;

const wasm_tester = require("circom_tester").wasm;

describe("Test circuit", function () {
    let circuit;

    this.timeout(10000000);

    before( async() => {
        circuit = await wasm_tester(path.join(__dirname, "..", "circuits", "circuit.circom"), {O:1, prime: "goldilocks"});
    });

    it("Should check the circuit for adding the number of bits of 2 bytes", async () => {
        const input={
            in: [1, 2, 3]
        };
        const w1 = await circuit.calculateWitness(input, true);

        await circuit.assertOut(w1, {out: 4});
    });

});
