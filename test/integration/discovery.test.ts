//TODO: Test that The sorting is the same for esplora and electrum with older
//txs at the beginning of the array and mempool ones at the end
//TODO: Test error if getUtxos without first discoverTxs or discover
//TODO: Test duplicated expressions (or expressions that generate the same scriptPubKeys) -> getUtxos / getBalance should fail
//
//Some electrum servers:
//https://1209k.com/bitcoin-eye/ele.php

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
import { DiscoveryFactory, TxStatus } from '../../dist';

import { fixtures } from '../fixtures/discovery';
const network = networks.regtest;

const regtestTest = false;

const onUsed = (expressions: string | Array<string>) => {
  console.log(`TRACE - onUsed(${expressions}`);
};

if (regtestTest) {
  const explorer = new EsploraExplorer({ url: ESPLORA_LOCAL_REGTEST_URL });
  const { Discovery } = DiscoveryFactory(explorer);
  describe('Discovery on regtest', () => {
    test(`Fund`, async () => {
      //Let's fund (if needed fund=true) && test (fund=false) the descriptors:
      for (const funding of [true, false]) {
        for (const descriptor of fixtures.regtest.descriptors) {
          if (descriptor.expression.indexOf('*') !== -1) {
            for (const key in descriptor.funds) {
              const index = parseInt(key, 10);
              const address = new Descriptor({
                expression: descriptor.expression,
                network,
                index
              }).getAddress();
              const value = descriptor.funds[index]!;
              const { balance } = await explorer.fetchAddress(address);
              if (funding) {
                //Only fund it if this file has not been run already
                if (balance === 0) await regtestUtils.faucet(address, value);
              } else {
                expect(balance).toEqual(value);
              }
            }
          } else if (typeof descriptor.value !== 'undefined') {
            //This is a non-ranged descriptor
            const address = new Descriptor({
              expression: descriptor.expression,
              network
            }).getAddress();
            const value = descriptor.value;
            const { balance } = await explorer.fetchAddress(address);
            if (funding) {
              //Only fund it if this file has not been run already
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
        for (const descriptor of fixtures.regtest.descriptors) {
          await discovery.discover({
            //gapLimit: 1, //TODO: TEST THIS. with gapLimit 1 it should not get anything
            expressions: descriptor.expression,
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
          onUsed
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
      },
      60 * 5 * 1000
    );
  });
}

console.log(ElectrumExplorer);
for (const network of [networks.bitcoin]) {
  for (const explorer of [
    //Some servers: https://1209k.com/bitcoin-eye/ele.php
    //new EsploraExplorer({
    //  url:
    //    network === networks.testnet
    //      ? 'https://blockstream.info/testnet/api'
    //      : 'https://blockstream.info/api'
    //})
    //new ElectrumExplorer({
    //  host: 'electrum.bitaroo.net',
    //  port: 50002,
    //  protocol: 'ssl',
    //  network
    //})
    //new ElectrumExplorer({
    //  host: 'electrum.blockstream.info',
    //  port: 50002,
    //  protocol: 'ssl',
    //  network
    //})
    new ElectrumExplorer({
      //host: 'btc.lastingcoin.net', //time out on bitcoind
      //host: 'electrum.bitcoinserver.nl', //ETIMEDOUT - this is a small server, low resources.
      //host: 'fulcrum.not.fyi', //TIMEOUT
      //host: 'bolt.schulzemic.net', // -> Mega fast
      //host: 'fulcrum.theuplink.net', //TIMEOUT
      //host: 'f006.fuchsia.fastwebserver.de', fulcrum fast on recache
      //host: 'electrum-btc.leblancnet.us', //Electrumx
      host: 'electrum1.bluewallet.io', //Also quite fast TBH COLD: FirstCall: 29375 ms - SecondCall: 3714 ms - HOT: SIMILAR
      //port: 50002,
      port: 443,
      protocol: 'ssl',
      network
    })
  ])
    describe(`Discovery on ${network.bech32}`, () => {
      test(
        `Discover Abandon`,
        async () => {
          const { Discovery } = DiscoveryFactory(explorer);
          const masterNode = BIP32.fromSeed(
            mnemonicToSeedSync(
              //'camp foam advice east amount dolphin aspect drift dumb column job absorb' //unused
              'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
              //'oil oil oil oil oil oil oil oil oil oil oil oil'
            ),
            network
          );
          const discovery = new Discovery();
          await explorer.connect();
          console.time('FirstCall');
          await discovery.discoverStandardWallets({
            masterNode,
            network,
            onUsed
          });
          console.timeEnd('FirstCall');
          console.time('SecondCall');
          await discovery.discoverStandardWallets({
            masterNode,
            network,
            onUsed
          });
          console.timeEnd('SecondCall');

          for (const expressions of discovery.getWallets({ network })) {
            const balance = discovery.getBalance({
              network,
              expressions,
              txStatus: TxStatus.ALL
            });
            console.log(`Balance for ${expressions}: ${balance}`);
          }
          //console.log(JSON.stringify(discovery.getDiscoveryInfo(), null, 2));
        },
        60 * 10 * 1000
      );
    });
}
