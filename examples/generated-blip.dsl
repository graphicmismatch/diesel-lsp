// Petroleum Diesel script
patch {
    version = 6;
    origin = { category = "Blip", seed = "7" };

    Trigger trigger1 {
        x = 40; y = 40;
    }
    Constant constant1 {
        x = 40; y = 160;
        state = { value = "0.0026918314" };
    }
    Constant constant2 {
        x = 40; y = 250;
        state = { value = "0.024163542" };
    }
    Constant constant3 {
        x = 40; y = 340;
        state = { value = "0.07038295" };
    }
    Constant constant4 {
        x = 40; y = 430;
        state = { value = "0.038451523" };
    }
    Constant constant5 {
        x = 40; y = 540;
        state = { value = "1157.6292" };
    }
    Constant constant6 {
        x = 40; y = 630;
        state = { value = "1258.6814" };
    }
    Constant constant7 {
        x = 40; y = 720;
        state = { value = "0.016966194" };
    }
    Constant constant8 {
        x = 40; y = 830;
        state = { value = "14799.305" };
    }
    Envelope envelope1 {
        x = 280; y = 120;
    }
    Ramp ramp1 {
        x = 280; y = 560;
    }
    Phasor phasor1 {
        x = 500; y = 560;
    }
    Oscillator oscillator1 {
        x = 700; y = 560;
        oscillator = { kind = "factory", name = "Square" };
    }
    "Biquad Lowpass" biquad_lowpass1 {
        x = 900; y = 560;
    }
    Amplifier amplifier1 {
        x = 1100; y = 300;
    }
    "Audio Out" audio_out1 {
        x = 1320; y = 300;
    }

    trigger1.out -> envelope1.trigger;
    constant1.out -> envelope1.attack;
    constant2.out -> envelope1.sustain;
    constant3.out -> envelope1.punch;
    constant4.out -> envelope1.decay;
    trigger1.out -> ramp1.trigger;
    constant5.out -> ramp1.from;
    constant6.out -> ramp1.to;
    constant7.out -> ramp1.time;
    ramp1.out -> phasor1.frequency;
    phasor1.out -> oscillator1.phase;
    oscillator1.out -> biquad_lowpass1.in;
    constant8.out -> biquad_lowpass1.cutoff;
    biquad_lowpass1.out -> amplifier1.in;
    envelope1.out -> amplifier1.gain;
    amplifier1.out -> audio_out1.in;

    macro "Pitch" -> constant5(20, 12000);
    macro "Slide" -> constant6(20, 12000);
    macro "Slide Time" -> constant7(0, 2);
    macro "Attack" -> constant1(0, 2);
    macro "Sustain" -> constant2(0, 2);
    macro "Punch" -> constant3(0, 1);
    macro "Decay" -> constant4(0, 2);
    macro "Bright" -> constant8(100, 16000);
}
