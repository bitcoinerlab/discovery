// Copyright (c) 2023 Jose-Luis Landabaso - https://bitcoinerlab.com
// Distributed under the MIT software license
//Created with:
//https://codesandbox.io/s/inspiring-spence-tbjdoj?file=/index.ts
export const fixtures = {
  regtest: {
    gapLimit: 10,
    irrevConfThresh: 6,
    mnemonic: `tenant worth pistol rabbit praise drop pink toddler pony brown raven super`,
    descriptors: [
      {
        descriptor:
          "pkh([a0809f04/44'/1'/0']tpubDDZgrqYqZ8KhKDKYp1Skpg4S11C3PptLU5LgTg57HY6B3qEYb571N2AQUbRoAZduqtKnBDJDerXS588TKTcB3AP7rpoeUHu49mqZz4Ctnjp/100/*)",
        range: {
          1: 100000000n,
          4: 5000000n,
          14: 6000n,
          25: 1500000000n
        }
      },
      {
        descriptor:
          "pkh([a0809f04/44'/1'/1']tpubDDZgrqYqZ8KhNvcgoHZtkvKz87zzm6yGvEsLXyrchph9CAd43Qv8nGR1KD7WhwLGXCLq9HZwk2gyknQrdRDjjeeR9bK18APCeRPfwnYt7nH/100/*)",
        range: {}
      },
      {
        descriptor:
          "pkh([a0809f04/44'/1'/2']tpubDDZgrqYqZ8KhRWoLmi9dXgxi14b3wuD9afKWgf4t2dGSUaEWmNsZ9Xwa6MxtLA2WakTSVpNL4MGrHBFs9TRr99p9GLN5arF8PWnZNn7P2Gp/100/0)",
        range: { 'non-ranged': 123123n }
      },
      {
        descriptor:
          "pkh([a0809f04/44'/1'/10']tpubDDZgrqYqZ8Khmoc8cgxe51g1GchJ9F3MZHebGJEKkX5JtuRHUQysf4sSWiobEeEWNKjg7xVkZSZw549PU8LCwNRXRYhUZGfZ7xxNEE9uoPA/100/*)#52y3898q",
        range: {
          1: 100000000n,
          4: 5000000n,
          14: 6000n,
          25: 1500000000n
        }
      },
      {
        descriptor:
          "pkh([a0809f04/44'/1'/11']tpubDDZgrqYqZ8KhoFt46NvUJd2jkx5WJFjJ1P5HgKkFBWPndykmFg7o8pqJ2jEmzRugsqyDPrkbMXZo7v382Uqav6y34hYCcYhjgtWAYG8BfdR/100/*)#tmgqw53j",
        range: {}
      },
      {
        descriptor:
          "pkh([a0809f04/44'/1'/12']tpubDDZgrqYqZ8KhsUuuUYn7Yu48sRy79zAZwps2Tv64RA3HJCmBkCUdeuj3UWz5vMEWBPUGMLF6jpkL9BWoWcbg2xJc5dcfpz8ooLFfboiZfa4/100/0)#4h3cswf0",
        range: { 'non-ranged': 123123n }
      },
      {
        descriptor:
          "pkh([a0809f04/44'/1'/2']tpubDDZgrqYqZ8KhRWoLmi9dXgxi14b3wuD9afKWgf4t2dGSUaEWmNsZ9Xwa6MxtLA2WakTSVpNL4MGrHBFs9TRr99p9GLN5arF8PWnZNn7P2Gp/100/*)",
        range: {},
        error:
          "The provided scriptPubKey is already set: pkh([a0809f04/44'/1'/2']tpubDDZgrqYqZ8KhRWoLmi9dXgxi14b3wuD9afKWgf4t2dGSUaEWmNsZ9Xwa6MxtLA2WakTSVpNL4MGrHBFs9TRr99p9GLN5arF8PWnZNn7P2Gp/100/0), non-ranged."
      }
    ],
    nonDiscoveredDescriptor:
      "pkh([a0809f04/44'/1'/1']tpubDDZgrqYqZ8KhKDKYp1Skpg4S11C3PptLU5LgTg57HY6B3qEYb571N2AQUbRoAZduqtKnBDJDerXS588TKTcB3AP7rpoeUHu49mqZz4Ctnjp/100/*)"
  }
};
