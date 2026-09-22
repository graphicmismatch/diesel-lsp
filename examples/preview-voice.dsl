// Petroleum Diesel script
patch "Preview Voice" {
    version = 6;

    Constant constant1 {
        x = 0; y = 0;
        state = { value = "440.0" };
    }
    Constant constant2 {
        x = 0; y = 140;
        state = { value = "0.0" };
    }
    Constant constant3 {
        x = 0; y = 280;
        state = { value = "1.0" };
    }
    Phasor phasor1 {
        x = 260; y = 0;
    }
    Oscillator oscillator1 {
        x = 520; y = 0;
        oscillator = { kind = "factory", name = "Sine" };
    }
    ADSR adsr1 {
        x = 260; y = 160;
    }
    Amplifier amplifier1 {
        x = 520; y = 220;
    }
    Amplifier amplifier2 {
        x = 780; y = 80;
    }
    "Audio Out" audio_out1 {
        x = 1040; y = 80;
    }

    constant1.out -> phasor1.frequency;
    phasor1.out -> oscillator1.phase;
    constant2.out -> adsr1.gate;
    adsr1.out -> amplifier1.in;
    constant3.out -> amplifier1.gain;
    oscillator1.out -> amplifier2.in;
    amplifier1.out -> amplifier2.gain;
    amplifier2.out -> audio_out1.in;

    macro "pitch" -> constant1(20, 20000);
    macro "gate" -> constant2(0, 1);
    macro "velocity" -> constant3(0, 1);
}
