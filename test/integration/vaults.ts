// Copyright (c) 2023 Jose-Luis Landabaso - https://bitcoinerlab.com
// Distributed under the MIT software license

import { RegtestUtils } from 'regtest-client';
import { networks } from 'bitcoinjs-lib';
import * as secp256k1 from '@bitcoinerlab/secp256k1';
import * as descriptors from '@bitcoinerlab/descriptors';
import { mnemonicToSeedSync } from 'bip39';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { encode: olderEncode } = require('bip68');
import { compilePolicy } from '@bitcoinerlab/miniscript';
import { EsploraExplorer } from '@bitcoinerlab/explorer';
const { Output, BIP32, ECPair } = descriptors.DescriptorsFactory(secp256k1);

const regtestUtils = new RegtestUtils();
import { DiscoveryFactory } from '../../dist';

export const vaultsTests = () => {
  describe('Vaults', () => {
    const network = networks.regtest;
    const lockBlocks = 1;

    const SEED =
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

    const BALANCE = 10000;
    let standardDescriptors: Array<string>;
    let vaultDescriptor: string;
    let vaultAddress: string;
    beforeAll(async () => {
      await new Promise(resolve => setTimeout(resolve, 5000));
      const POLICY = (older: number) =>
        `or(pk(@panicKey),99@and(pk(@unvaultKey),older(${older})))`;
      const older = olderEncode({ blocks: lockBlocks });
      const { miniscript, issane } = compilePolicy(POLICY(older));
      if (!issane) throw new Error('Policy not sane');

      const masterNode = BIP32.fromSeed(mnemonicToSeedSync(SEED), network);
      standardDescriptors = [0, 1].map(change =>
        descriptors.scriptExpressions.wpkhBIP32({
          masterNode,
          network,
          account: 0,
          index: '*',
          change
        })
      );
      const unvaultKey = descriptors.keyExpressionBIP32({
        masterNode,
        originPath: "/0'",
        keyPath: '/0'
      });

      const panicPair = ECPair.makeRandom();
      const panicPubKey = panicPair.publicKey;

      vaultDescriptor = `wsh(${miniscript
        .replace('@unvaultKey', unvaultKey)
        .replace('@panicKey', panicPubKey.toString('hex'))})`;

      const vaultOutput = new Output({ descriptor: vaultDescriptor, network });
      vaultAddress = vaultOutput.getAddress();
      await regtestUtils.faucet(vaultAddress, BALANCE);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }, 11000);

    const esploraPort = process.env['ESPLORA_PORT'] || '3002';
    test('discover descriptors', async () => {
      const { Discovery } = DiscoveryFactory(
        new EsploraExplorer({ url: `http://127.0.0.1:${esploraPort}` }),
        network
      );
      const unspents = await regtestUtils.unspents(vaultAddress);
      expect(unspents.length).toBe(1);
      const discovery = new Discovery();
      const blockHeight = await regtestUtils.height();
      expect(blockHeight).toBeGreaterThan(0);
      const explorerBlockHeight = await discovery
        .getExplorer()
        .fetchBlockHeight();
      expect(blockHeight).toBe(explorerBlockHeight);
      const descriptors = [...standardDescriptors, vaultDescriptor];
      await discovery.fetch({ descriptors });
      const { utxos, balance } = discovery.getUtxosAndBalance({ descriptors });
      expect(utxos.length).toBe(1);
      expect(balance).toBe(BALANCE);
    }, 10000);
  });
};
