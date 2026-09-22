// Petroleum Diesel script
patch "Piano Roll Song" {
    version = 6;

    "Piano Roll" piano_roll1 {
        x = 0; y = 0;
        channels = 4;
        clip = "d0";
    }
    Phasor phasor1 {
        x = 260; y = 0;
    }
    Oscillator oscillator1 {
        x = 520; y = 0;
        oscillator = { kind = "factory", name = "Sine" };
    }
    ADSR adsr1 {
        x = 260; y = 200;
    }
    Amplifier amplifier1 {
        x = 780; y = 0;
    }
    "Audio Out" audio_out1 {
        x = 1040; y = 0;
    }

    piano_roll1.pitch0 -> phasor1.frequency;
    phasor1.out -> oscillator1.phase;
    piano_roll1.gate0 -> adsr1.gate;
    oscillator1.out -> amplifier1.in;
    adsr1.out -> amplifier1.gain;
    amplifier1.out -> audio_out1.in;
}

data d0 = b64"
    AwAAAAAGAAACAAAAAAAAAGAAAAAAAHBCAACAPwAAAAAAAAAAYAAAAAAAhkIzMzM/AQAAAAEAAAAA
    AAAAGgAAAAAAAAAAAAAABAAAAFVVBUEIAAAAVVWFQQwAAAAAAMhBEAAAAFVVBUIUAAAAq6omQhgA
    AAAAAEhCHAAAAFVVaUIgAAAAVVWFQiQAAAAAAJZCKAAAAKuqpkIsAAAAVVW3QjAAAAAAAMhCNAAA
    AKuq2EI4AAAAVVXpQjwAAAAAAPpCQAAAAFVVBUNEAAAAq6oNQ0gAAAAAABZDTAAAAFVVHkNQAAAA
    q6omQ1QAAAAAAC9DWAAAAFVVN0NcAAAAq6o/Q2AAAAAAAEhDZAAAAAAAAAA=
";
