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
import { ElectrumExplorer } from '@bitcoinerlab/explorer';
const { BIP32 } = descriptors.DescriptorsFactory(secp256k1);
import { DiscoveryFactory, TxStatus, Account } from '../../dist';

const onAccountUsed = (account: Account) => {
  console.log(`TRACE - onAccountUsed(${account}`);
};

console.log(ElectrumExplorer);
for (const network of [networks.bitcoin]) {
  for (const explorer of [
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
      network,
      irrevConfThresh: 3,
      maxTxPerScriptPubKey: 1000
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
          await discovery.discoverStandardAccounts({
            masterNode,
            network,
            onAccountUsed
          });
          console.timeEnd('FirstCall');
          console.time('SecondCall');
          await discovery.discoverStandardAccounts({
            masterNode,
            network,
            onAccountUsed
          });
          console.timeEnd('SecondCall');

          for (const account of discovery.getAccounts({ network })) {
            const descriptors = discovery.getAccountDescriptors({ account });
            console.log(
              `Next external index: ${discovery.getNextIndex({
                descriptor: descriptors[0],
                network,
                txStatus: TxStatus.ALL
              })}`
            );
            console.log(
              `Next internal index: ${discovery.getNextIndex({
                descriptor: descriptors[1],
                network,
                txStatus: TxStatus.ALL
              })}`
            );
            const { balance } = discovery.getUtxosAndBalance({
              network,
              descriptors,
              txStatus: TxStatus.ALL
            });
            console.log(`Balance for ${descriptors}: ${balance}`);
            const txHistory = discovery.getHistory({ descriptors, network });
            console.log(
              `Number of txs for ${descriptors}: ${txHistory.length}`
            );
            //console.log(
            //  `Transaction for first transaction of ${expressions}: ${discovery.getTxHex(
            //    { network, tx: utxos[0] }
            //  )}`
            //);
          }
          //console.log(JSON.stringify(discovery.getDiscoveryInfo(), null, 2));
          await explorer.close();
        },
        60 * 10 * 1000
      );
    });
}
