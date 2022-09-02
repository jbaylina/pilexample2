pragma circom 2.0.8;
pragma custom_templates;

template custom CountBits() {
    signal input in;
    signal output out;

    var a = in;
    var c = 0;

    while (a>0) {
        if (a&1) c += 1;
        a = a >> 1;
    }

    out <-- c;
}

template Main(n) {
    signal input in[n];
    signal output out;
    component countBits[n];

    var acc =0;

    for (var i=0; i<n ; i++) {
        countBits[i] = CountBits();
        countBits[i].in <== in[i];
        acc += countBits[i].out;
    }

    log(acc);
    out <== acc;
}

component main = Main(3);