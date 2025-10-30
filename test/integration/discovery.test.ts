// Copyright (c) 2023 Jose-Luis Landabaso - https://bitcoinerlab.com
// Distributed under the MIT software license

//TODO: TEST duplicates of scriptPubKey... Imagine expressions using uppercase/lowecase of the same or equivalent ones using xpub and wif for the same scriptPubKey for example...
//TEST: functions keep same reference
//TODO: Test that The sorting is the same for esplora and electrum with older
//txs at the beginning of the array and mempool ones at the end
//TODO: Test error if getUtxos without first discoverTxs or discover
//TODO: Test duplicated expressions (or expressions that generate the same scriptPubKeys) -> getUtxos / getBalance should fail
//
//Some electrum servers:
//https://1209k.com/bitcoin-eye/ele.php

import { networks } from 'bitcoinjs-lib';
import * as secp256k1 from '@bitcoinerlab/secp256k1';
import * as descriptors from '@bitcoinerlab/descriptors';
import { mnemonicToSeedSync } from 'bip39';
import { ElectrumExplorer, EsploraExplorer } from '@bitcoinerlab/explorer';
const { BIP32 } = descriptors.DescriptorsFactory(secp256k1);
import { DiscoveryFactory, TxStatus, Account } from '../../dist';

const onAccountUsed = async (_account: Account) => {
  //console.log(`TRACE - onAccountUsed(${account}`);
};

void ElectrumExplorer;
void EsploraExplorer;
for (const network of [networks.bitcoin]) {
  //if (network.bech32 !== 'foo-bar') throw new Error('ENABLE THIS LATER');
  for (const explorerAndInfo of [
    {
      explorer: new EsploraExplorer({
        url: 'https://blockstream.info/api/',
        requestQueueParams: {
          maxConcurrentTasks: 10
          //maxConcurrentTasks: 30
          //maxConcurrentTasks: 5 //default is 10
          //maxAttemptsForHardErrors: 10 //default is 5
        }
      }),
      info: 'EsploraExplorer'
    },
    {
      explorer: new ElectrumExplorer({
        //host: 'btc.lastingcoin.net', //time out on bitcoind
        //host: 'electrum.bitcoinserver.nl', //ETIMEDOUT - this is a small server, low resources.
        //host: 'fulcrum.not.fyi', //TIMEOUT
        //
        host: 'bolt.schulzemic.net', // -> Mega fast
        port: 50002,
        protocol: 'ssl',
        //
        //host: 'fulcrum.theuplink.net', //TIMEOUT
        //host: 'f006.fuchsia.fastwebserver.de', //fulcrum fast on recache
        //host: 'electrum-btc.leblancnet.us', //Electrumx
        //
        //host: 'electrum1.bluewallet.io', //Also quite fast TBH COLD: FirstCall: 29375 ms - SecondCall: 3714 ms - HOT: SIMILAR
        //port: 443,
        //protocol: 'ssl',
        //
        //
        //host: 'blockstream.info', //ssl, port 700
        //port: 700,
        //protocol: 'ssl',
        //
        network,
        irrevConfThresh: 3,
        maxTxPerScriptPubKey: 1000
      }),
      info: 'f006.fuchsia.fastwebserver.de'
    }

    //Some servers: https://1209k.com/bitcoin-eye/ele.php
    //new EsploraExplorer({
    //  url:
    //    network === networks.testnet
    //      ? 'https://blockstream.info/testnet/api'
    //      : 'https://blockstream.info/api', irrevConfThresh: 3, maxTxPerScriptPubKey: 1000
    //})
    //new ElectrumExplorer({
    //  host: 'electrum.bitaroo.net',
    //  port: 50002,
    //  protocol: 'ssl',
    //  network, irrevConfThresh: 3, maxTxPerScriptPubKey: 1000
    //})
    //new ElectrumExplorer({
    //  host: 'electrum.blockstream.info',
    //  port: 50002,
    //  protocol: 'ssl',
    //  network, irrevConfThresh: 3, maxTxPerScriptPubKey: 1000
    //})
  ])
    describe(`Discovery with ${explorerAndInfo.info} on ${network.bech32}`, () => {
      test(
        `Discover Abandon`,
        async () => {
          const { Discovery } = DiscoveryFactory(
            explorerAndInfo.explorer,
            network
          );
          const masterNode = BIP32.fromSeed(
            mnemonicToSeedSync(
              //'camp foam advice east amount dolphin aspect drift dumb column job absorb' //unused
              'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
              //'oil oil oil oil oil oil oil oil oil oil oil oil'
            ),
            network
          );
          const discovery = new Discovery();
          await explorerAndInfo.explorer.connect();
          console.time('FirstCall');
          await discovery.fetchStandardAccounts({
            masterNode,
            onAccountUsed
          });
          console.timeEnd('FirstCall');
          console.time('SecondCall'); //This one should be significanlty faster
          await discovery.fetchStandardAccounts({
            masterNode,
            onAccountUsed
          });
          console.timeEnd('SecondCall');

          for (const account of discovery.getUsedAccounts()) {
            const descriptors = discovery.getAccountDescriptors({ account });
            //console.log(
            //  `Next external index: ${discovery.getNextIndex({
            //    descriptor: descriptors[0],
            //    txStatus: TxStatus.ALL
            //  })}`
            //);
            //console.log(
            //  `Next internal index: ${discovery.getNextIndex({
            //    descriptor: descriptors[1],
            //    txStatus: TxStatus.ALL
            //  })}`
            //);
            const { balance } = discovery.getUtxosAndBalance({
              descriptors,
              txStatus: TxStatus.ALL
            });
            expect(balance).toEqual(0);
            //console.log(`Balance for ${descriptors}: ${balance}`);
            const txHistory = discovery.getHistory({ descriptors });
            expect(txHistory.length).toBeGreaterThan(0);
            //console.log(
            //  `Number of txs for ${descriptors}: ${txHistory.length}`
            //);
            //console.log(
            //  `Transaction for first transaction of ${expressions}: ${discovery.getTxHex(
            //    { utxo: utxos[0] }
            //  )}`
            //);
          }
          //console.log(JSON.stringify(discovery.getDiscoveryInfo(), null, 2));
          explorerAndInfo.explorer.close();
        },
        180 * 10 * 1000 //30 minutes
      );
    });
}
