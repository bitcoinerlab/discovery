// Copyright (c) 2023 Jose-Luis Landabaso - https://bitcoinerlab.com
// Distributed under the MIT software license

//TODO: TEST with gapLimit 1 -> it should not get anything
//TODO: Test this error below
//{
//  expression: `pkh([a0809f04/44'/1'/2']tpubDDZgrqYqZ8KhRWoLmi9dXgxi14b3wuD9afKWgf4t2dGSUaEWmNsZ9Xwa6MxtLA2WakTSVpNL4MGrHBFs9TRr99p9GLN5arF8PWnZNn7P2Gp/0/*)`,
//  value: 123123,
//  error: 'duplicated utxoId'
//}
//TODO: test an unrangedDescriptor as above without value. It should not appear???
//TODO: tests with used both for unrangedDescriptor and ranged and using pubkey instad of bip32, this should be detected
import { RegtestUtils } from 'regtest-client';
import { networks } from 'bitcoinjs-lib';
import * as secp256k1 from '@bitcoinerlab/secp256k1';
import * as descriptors from '@bitcoinerlab/descriptors';
import { mnemonicToSeedSync } from 'bip39';
import {
  EsploraExplorer,
  ElectrumExplorer,
  ESPLORA_LOCAL_REGTEST_URL
} from '@bitcoinerlab/explorer';
const { Descriptor, BIP32 } = descriptors.DescriptorsFactory(secp256k1);
const regtestUtils = new RegtestUtils();
import { DiscoveryFactory, Wallet } from '../../dist';

import { fixtures } from '../fixtures/discovery';
const network = networks.regtest;

const onWalletUsed = (wallet: Wallet) => {
  console.log(`TRACE - onWalletUsed(${wallet}`);
};

describe('Discovery on regtest', () => {
  for (const explorer of [
    {
      name: 'Esplora',
      instance: new EsploraExplorer({
        url: ESPLORA_LOCAL_REGTEST_URL,
        irrevConfThresh: 3,
        maxTxPerScriptPubKey: 1000
      })
    },
    {
      name: 'Electrum',
      instance: new ElectrumExplorer({
        network,
        irrevConfThresh: 3,
        maxTxPerScriptPubKey: 1000
      })
    }
  ]) {
    const { Discovery } = DiscoveryFactory(explorer.instance);
    test(`Connects to ${explorer.name}`, async () => {
      expect(async () => {
        await explorer.instance.connect();
      }).not.toThrow();
    });
    //Let's fund (if needed fund=true) && test (fund=false) the descriptors:
    for (const funding of [true, false]) {
      test(
        funding
          ? 'Faucet funds if balance = 0'
          : `Retrieve balance with explorer.fetchAddress using ${explorer.name}`,
        async () => {
          for (const { expression, scriptPubKeys, error } of fixtures.regtest
            .descriptors) {
            if (!error)
              for (const [index, value] of Object.entries(scriptPubKeys)) {
                const address = new Descriptor({
                  expression,
                  network,
                  ...(index === 'non-ranged' ? {} : { index: Number(index) })
                }).getAddress();
                const { balance } = await explorer.instance.fetchAddress(
                  address
                );
                if (funding && balance === 0) {
                  const unspent = await regtestUtils.faucet(address, value);
                  expect(unspent.value).toEqual(value);
                }
                expect(balance).toEqual(value);
              }
          }
          //Confirm the transactions above
          if (funding) {
            await regtestUtils.mine(6);
            await new Promise(resolve => setTimeout(resolve, 5000)); //sleep 5 sec
          }
        },
        20000
      );
    }

    test(
      `Discover on regtest`,
      async () => {
        const discovery = new Discovery();
        for (const { expression, error } of fixtures.regtest.descriptors) {
          if (error) {
            await expect(
              discovery.discover({
                expressions: expression,
                network
              })
            ).rejects.toThrow(error);
          } else {
            await expect(
              discovery.discover({
                expressions: expression,
                network
              })
            ).resolves.not.toThrow();
          }
        }
        const masterNode = BIP32.fromSeed(
          mnemonicToSeedSync(fixtures.regtest.mnemonic),
          network
        );
        await discovery.discoverStandardWallets({
          masterNode,
          network,
          onWalletUsed
        });
        //console.log(
        //  JSON.stringify(
        //    discovery.getWallets({ network: networks.regtest }),
        //    null,
        //    2
        //  )
        //);
        //await discovery.discoverTxs({ network });
        //console.log(JSON.stringify(discovery.getDiscoveryInfo(), null, 2));
      },
      60 * 5 * 1000
    );

    //test(`Invalid`, async () => {
    //  await.discovery.discover({
    //});

    test(`Closes ${explorer.name}`, async () => {
      expect(async () => {
        await explorer.instance.close();
      }).not.toThrow();
    });
  }
});