//Created with:
//https://codesandbox.io/s/inspiring-spence-tbjdoj?file=/index.ts
export const fixtures = {
  regtest: {
    mnemonic: `tenant worth pistol rabbit praise drop pink toddler pony brown raven super`,
    descriptors: [
      {
        expression: `pkh([a0809f04/44'/1'/0']tpubDDZgrqYqZ8KhKDKYp1Skpg4S11C3PptLU5LgTg57HY6B3qEYb571N2AQUbRoAZduqtKnBDJDerXS588TKTcB3AP7rpoeUHu49mqZz4Ctnjp/0/*)`,
        funds: { 1: 100000000, 12: 5000000, 34: 6000, 55: 1500000000 } as {
          [key: number]: number;
        }
      },
      {
        expression: `pkh([a0809f04/44'/1'/1']tpubDDZgrqYqZ8KhNvcgoHZtkvKz87zzm6yGvEsLXyrchph9CAd43Qv8nGR1KD7WhwLGXCLq9HZwk2gyknQrdRDjjeeR9bK18APCeRPfwnYt7nH/0/*)`
      },
      {
        expression: `pkh([a0809f04/44'/1'/2']tpubDDZgrqYqZ8KhRWoLmi9dXgxi14b3wuD9afKWgf4t2dGSUaEWmNsZ9Xwa6MxtLA2WakTSVpNL4MGrHBFs9TRr99p9GLN5arF8PWnZNn7P2Gp/0/0)`,
        value: 123123
      }
      //TODO: test an unrangedDescriptor as above without value. It should not appear???
    ]
  }
};
