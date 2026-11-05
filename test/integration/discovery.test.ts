// Copyright (c) 2026 Jose-Luis Landabaso - https://bitcoinerlab.com
// Distributed under the MIT software license

import { networks } from 'bitcoinjs-lib';
import * as secp256k1 from '@bitcoinerlab/secp256k1';
import {
  DescriptorsFactory,
  scriptExpressions
} from '@bitcoinerlab/descriptors';
import { ElectrumExplorer, EsploraExplorer } from '@bitcoinerlab/explorer';
import { DiscoveryFactory, TxStatus } from '../../dist';
import { regtestUtils, esploraURL, electrumPort } from '../helpers/regtest';
import { waitFor } from '../helpers/waitFor';

const network = networks.regtest;
const { BIP32, Output } = DescriptorsFactory(secp256k1);
// Use a distinct wallet so funding cannot affect the regtest and vault tests.
const masterNode = BIP32.fromSeed(new Uint8Array(32).fill(7), network);
const descriptor = scriptExpressions.wpkhBIP32({
  masterNode,
  network,
  account: 0,
  change: 0,
  index: 0
});
const address = new Output({ descriptor, network }).getAddress();
const value = 50000;
let funding: Awaited<ReturnType<typeof regtestUtils.faucet>>;

beforeAll(async () => {
  funding = await regtestUtils.faucet(address, value);
});

for (const { name, explorer } of [
  { name: 'Esplora', explorer: new EsploraExplorer({ url: esploraURL }) },
  {
    name: 'Electrum',
    explorer: new ElectrumExplorer({
      host: '127.0.0.1',
      port: electrumPort,
      protocol: 'tcp',
      network
    })
  }
]) {
  describe(`Standard account discovery with local ${name}`, () => {
    afterAll(() => {
      if (!explorer.isClosed()) explorer.close();
    });

    test('discovers a funded account and its known UTXO', async () => {
      await explorer.connect();
      await waitFor(`${name} to index funding ${funding.txId}`, async () => {
        const history = await explorer.fetchTxHistory({ address });
        expect(history.some(tx => tx.txId === funding.txId)).toBe(true);
      });

      const { Discovery } = DiscoveryFactory(explorer, network);
      const discovery = new Discovery();
      await discovery.fetchStandardAccounts({ masterNode });
      const accounts = discovery.getUsedAccounts();
      expect(accounts).toHaveLength(1);
      const descriptors = discovery.getAccountDescriptors({
        account: accounts[0]!
      });
      const { balance, utxos } = discovery.getUtxosAndBalance({
        descriptors,
        txStatus: TxStatus.ALL
      });
      expect(balance).toBe(BigInt(value));
      expect(utxos).toEqual([`${funding.txId}:${funding.vout}`]);
      expect(discovery.getHistory({ descriptors })).toHaveLength(1);
    }, 35000);
  });
}
