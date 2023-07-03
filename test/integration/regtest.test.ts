// Copyright (c) 2023 Jose-Luis Landabaso - https://bitcoinerlab.com
// Distributed under the MIT software license

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
    test(`Fund with ${explorer.name}`, async () => {
      await explorer.instance.connect();
      //Let's fund (if needed fund=true) && test (fund=false) the descriptors:
      for (const funding of [true, false]) {
        for (const [expression, scriptPubKeys] of Object.entries(
          fixtures.regtest.descriptors
        )) {
          for (const [index, value] of Object.entries(scriptPubKeys)) {
            const address = new Descriptor({
              expression,
              network,
              ...(index === 'non-ranged' ? {} : { index: Number(index) })
            }).getAddress();
            const { balance } = await explorer.instance.fetchAddress(address);
            if (funding) {
              //Fund it only when not been founded already (in previous test runs)
              if (balance === 0) await regtestUtils.faucet(address, value);
            } else {
              expect(balance).toEqual(value);
            }
          }
        }
        //Confirm the transactions above
        if (funding) {
          await regtestUtils.mine(6);
          await new Promise(resolve => setTimeout(resolve, 5000)); //sleep 5 sec
        }
      }
    }, 20000);

    test(
      `Discover on regtest`,
      async () => {
        const discovery = new Discovery();
        for (const expression of Object.keys(fixtures.regtest.descriptors)) {
          await discovery.discover({
            //gapLimit: 1, //TODO: TEST THIS. with gapLimit 1 it should not get anything
            expressions: expression,
            network
          });
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
        console.log(JSON.stringify(discovery.getDiscoveryInfo(), null, 2));
        await explorer.instance.close();
      },
      60 * 5 * 1000
    );
  }
});
