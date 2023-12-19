// Copyright (c) 2023 Jose-Luis Landabaso - https://bitcoinerlab.com
// Distributed under the MIT software license

//TODO: expect something on discoverStandardAccounts
//TODO: Test immutability
//TODO: Test this error below
//{
//  expression: `pkh([a0809f04/44'/1'/2']tpubDDZgrqYqZ8KhRWoLmi9dXgxi14b3wuD9afKWgf4t2dGSUaEWmNsZ9Xwa6MxtLA2WakTSVpNL4MGrHBFs9TRr99p9GLN5arF8PWnZNn7P2Gp/0/*)`,
//  value: 123123,
//  error: 'duplicated utxoId'
//}
//TODO: test an unrangedDescriptor as above without value. It should not appear???
//TODO: tests with used both for unrangedDescriptor and ranged and using pubkey instad of bip32, this should be detected
//TODO: test the rest of methods
import { vaultsTests } from './vaults';
import { RegtestUtils } from 'regtest-client';
import { networks } from 'bitcoinjs-lib';
import * as secp256k1 from '@bitcoinerlab/secp256k1';
import * as descriptors from '@bitcoinerlab/descriptors';
import { mnemonicToSeedSync } from 'bip39';
import {
  EsploraExplorer,
  ElectrumExplorer,
  Explorer,
  ESPLORA_LOCAL_REGTEST_URL
} from '@bitcoinerlab/explorer';
const { Output, BIP32 } = descriptors.DescriptorsFactory(secp256k1);
const regtestUtils = new RegtestUtils();
import {
  DiscoveryFactory,
  DiscoveryInstance,
  Account,
  TxStatus,
  Utxo
} from '../../dist';
type DescriptorIndex = number | 'non-ranged';
const ESPLORA_CATCHUP_TIME = 5000;

import { fixtures } from '../fixtures/discovery';
const network = networks.regtest;
const gapLimit = fixtures.regtest.gapLimit;
const irrevConfThresh = fixtures.regtest.irrevConfThresh;

const onAccountUsed = (_account: Account) => {
  //console.log(`TRACE - onAccountUsed(${account}`);
};

const parseScriptPubKeys = (range: Record<DescriptorIndex, number>) => {
  let rangeArray: Array<{
    index: DescriptorIndex;
    balance: number;
    outOfGapLimit?: boolean;
  }> = Object.entries(range).map(([indexStr, balance]) => {
    const index = indexStr === 'non-ranged' ? indexStr : Number(indexStr);
    return { index, balance };
  });

  // Sort the rangeArray
  rangeArray = rangeArray.sort((a, b) => {
    if (a.index === 'non-ranged' || b.index === 'non-ranged') return 0;
    return (a.index as number) - (b.index as number);
  });

  let previousIndex = 0;
  let totalBalance = 0;
  rangeArray = rangeArray.map(entry => {
    let outOfGapLimit = false;
    if (
      typeof entry.index === 'number' &&
      entry.index - previousIndex > gapLimit //GAP_LIMIT
    )
      outOfGapLimit = true;
    else totalBalance += entry.balance;

    previousIndex =
      typeof entry.index === 'number' ? entry.index : previousIndex;
    return { ...entry, outOfGapLimit };
  });
  const totalUtxosCount = rangeArray.filter(
    entry => !entry.outOfGapLimit
  ).length;
  return { rangeArray, totalBalance, totalUtxosCount };
};

describe('Discovery on regtest', () => {
  //Let's fund (if needed fund=true) && test (fund=false) the descriptors:
  for (const funding of [true, false]) {
    test(
      funding ? 'Faucet funds descriptors' : `Funds have been set`,
      async () => {
        for (const { descriptor, range } of fixtures.regtest.descriptors) {
          for (const [indexStr, value] of Object.entries(range)) {
            const address = new Output({
              descriptor,
              network,
              ...(indexStr === 'non-ranged' ? {} : { index: Number(indexStr) })
            }).getAddress();
            let unspents:
              | Awaited<ReturnType<typeof regtestUtils.unspents>>
              | undefined;
            const ATTEMPTS = 10;
            for (let i = 0; i < ATTEMPTS; i++) {
              try {
                unspents = await regtestUtils.unspents(address);
                break;
              } catch (err: unknown) {
                const message = (err as Error).message;
                console.warn(`Attempt #${i + 1} to access a node: ${message}`);
                // Wait for 1 sec except after the final attempt
                if (i < ATTEMPTS - 1)
                  await new Promise(resolve => setTimeout(resolve, 1000));
              }
            }
            if (!unspents) throw new Error('All attempts failed');
            expect([0, 1]).toContain(unspents.length);
            let unspent = unspents[0];
            if (funding) {
              expect(unspent).toEqual(undefined);
              unspent = await regtestUtils.faucet(address, value);
            }
            const balance = (unspent && unspent.value) || 0;
            expect(balance).toEqual(value);
          }
        }
      },
      20000
    );
  }
  const discoverers: Array<{
    name: string;
    explorer: Explorer;
    discovery?: DiscoveryInstance;
  }> = [];
  discoverers.push(
    {
      name: 'Esplora',
      explorer: new EsploraExplorer({
        url: ESPLORA_LOCAL_REGTEST_URL,
        irrevConfThresh,
        maxTxPerScriptPubKey: 1000
      })
    },
    {
      name: 'Electrum',
      explorer: new ElectrumExplorer({
        network,
        irrevConfThresh,
        maxTxPerScriptPubKey: 1000
      })
    }
  );
  for (const discoverer of discoverers) {
    test(`Connects ${discoverer.name} explorer and sets up Discovery`, async () => {
      await expect(discoverer.explorer.connect()).resolves.not.toThrow();
      expect(await discoverer.explorer.fetchBlockHeight()).toEqual(
        await regtestUtils.height()
      );
      const { Discovery } = DiscoveryFactory(discoverer.explorer, network);
      discoverer.discovery = new Discovery();
    });
  }

  let totalMined = 0;
  for (const blocksToMine of [
    0 /*mempool*/,
    1 /*confirmed*/,
    irrevConfThresh - 2 /*still only confirmed*/,
    1 /*irreversible*/
  ]) {
    test(
      `Mine ${blocksToMine} blocks`,
      async () => {
        if (blocksToMine !== 0) {
          await regtestUtils.mine(blocksToMine);
        }
        totalMined += blocksToMine;
        //sleep a bit to let esplora catch up
        await new Promise(resolve => setTimeout(resolve, ESPLORA_CATCHUP_TIME));
      },
      ESPLORA_CATCHUP_TIME + 1000
    );
    for (const { explorer, name } of discoverers) {
      test(`Block height for ${name} after ${blocksToMine} block`, async () => {
        const blockHeight = await regtestUtils.height();
        const explorerBlockHeight = await explorer.fetchBlockHeight();
        expect(explorerBlockHeight).toEqual(blockHeight);
      });
    }

    for (const discoverer of discoverers) {
      for (const { descriptor, range, error } of fixtures.regtest.descriptors) {
        if (error) {
          test(`Invalid: Discover ${descriptor} throws using ${discoverer.name} after ${totalMined} blocks`, async () => {
            await expect(
              discoverer.discovery!.fetch({
                gapLimit,
                descriptor
              })
            ).rejects.toThrow(error);
          });
        } else {
          const { Discovery } = DiscoveryFactory(discoverer.explorer, network);
          test(`Discover ${descriptor} using ${discoverer.name} after ${totalMined} blocks`, async () => {
            await expect(
              discoverer.discovery!.fetch({
                gapLimit,
                descriptor
              })
            ).resolves.not.toThrow();
          });

          // Convert entries into array of objects
          const { totalBalance, totalUtxosCount, rangeArray } =
            parseScriptPubKeys(range as Record<DescriptorIndex, number>);
          for (const { index, balance, outOfGapLimit } of rangeArray) {
            let balanceDefault: number;
            let utxosDefault: Array<Utxo>;
            test(`getUtxosAndBalance default status for ${descriptor}:${index} using ${discoverer.name} after ${totalMined} blocks`, () => {
              if (outOfGapLimit) {
                const when = discoverer.discovery!.whenFetched({
                  descriptor,
                  ...(index === 'non-ranged' ? {} : { index: Number(index) })
                });
                expect(when).toEqual(undefined);
                expect(() => {
                  discoverer.discovery!.getUtxosAndBalance({
                    descriptor,
                    ...(index === 'non-ranged' ? {} : { index: Number(index) })
                  });
                }).toThrow();
              } else {
                ({ balance: balanceDefault, utxos: utxosDefault } =
                  discoverer.discovery!.getUtxosAndBalance({
                    descriptor,
                    ...(index === 'non-ranged' ? {} : { index: Number(index) })
                  }));
                expect(balanceDefault).toEqual(balance);
                expect(utxosDefault.length).toEqual(1);
              }
            });
            test(`getUtxosAndBalance ALL (and immutability wrt default) for ${descriptor}:${index} using ${discoverer.name} after ${totalMined} blocks`, () => {
              if (outOfGapLimit) {
                const when = discoverer.discovery!.whenFetched({
                  descriptor,
                  ...(index === 'non-ranged' ? {} : { index: Number(index) })
                });
                expect(when).toEqual(undefined);
                expect(() => {
                  discoverer.discovery!.getUtxosAndBalance({
                    descriptor,
                    ...(index === 'non-ranged' ? {} : { index: Number(index) })
                  });
                }).toThrow();
              } else {
                const { balance: balanceAll, utxos: utxosAll } =
                  discoverer.discovery!.getUtxosAndBalance({
                    descriptor,
                    ...(index === 'non-ranged' ? {} : { index: Number(index) }),
                    txStatus: TxStatus.ALL
                  });
                expect(balanceAll).toEqual(balance);
                expect(utxosAll).toEqual(utxosDefault); //These references should be equal
              }
            });

            test(`getUtxosAndBalance CONFIRMED for ${descriptor}:${index} using ${discoverer.name} after ${totalMined} blocks`, () => {
              if (outOfGapLimit) {
                const when = discoverer.discovery!.whenFetched({
                  descriptor,
                  ...(index === 'non-ranged' ? {} : { index: Number(index) })
                });
                expect(when).toEqual(undefined);
                expect(() => {
                  discoverer.discovery!.getUtxosAndBalance({
                    descriptor,
                    ...(index === 'non-ranged' ? {} : { index: Number(index) })
                  });
                }).toThrow();
              } else {
                const { balance: balanceConfirmed, utxos: utxosConfirmed } =
                  discoverer.discovery!.getUtxosAndBalance({
                    descriptor,
                    ...(index === 'non-ranged' ? {} : { index: Number(index) }),
                    txStatus: TxStatus.CONFIRMED
                  });
                expect(utxosConfirmed.length).toEqual(totalMined > 0 ? 1 : 0);
                expect(balanceConfirmed).toEqual(totalMined > 0 ? balance : 0);
                expect(utxosConfirmed).not.toBe(utxosDefault); //These references should be different
              }
            });
            test(`getUtxosAndBalance IRREVERSIBLE for ${descriptor}:${index} using ${discoverer.name} after ${totalMined} blocks`, () => {
              if (outOfGapLimit) {
                const when = discoverer.discovery!.whenFetched({
                  descriptor,
                  ...(index === 'non-ranged' ? {} : { index: Number(index) })
                });
                expect(when).toEqual(undefined);
                expect(() => {
                  discoverer.discovery!.getUtxosAndBalance({
                    descriptor,
                    ...(index === 'non-ranged' ? {} : { index: Number(index) })
                  });
                }).toThrow();
              } else {
                const {
                  balance: balanceIrreversible,
                  utxos: utxosIrreversible
                } = discoverer.discovery!.getUtxosAndBalance({
                  descriptor,
                  ...(index === 'non-ranged' ? {} : { index: Number(index) }),
                  txStatus: TxStatus.IRREVERSIBLE
                });
                expect(utxosIrreversible.length).toEqual(
                  totalMined >= irrevConfThresh ? 1 : 0
                );
                expect(balanceIrreversible).toEqual(
                  totalMined >= irrevConfThresh ? balance : 0
                );
                expect(utxosIrreversible).not.toBe(utxosDefault); //These references should be different
              }
            });
          }
          let balanceDefault: number;
          let utxosDefault: Array<Utxo>;
          test(`getUtxosAndBalance default status for ${descriptor} using ${discoverer.name} after ${totalMined} blocks`, () => {
            ({ balance: balanceDefault, utxos: utxosDefault } =
              discoverer.discovery!.getUtxosAndBalance({
                descriptor
              }));
            expect(balanceDefault).toEqual(totalBalance);
            expect(utxosDefault.length).toEqual(totalUtxosCount);
            //import & export
            expect(
              new Discovery({
                imported: discoverer.discovery!.export()
              }).getUtxosAndBalance({ descriptor })
            ).toEqual({ balance: balanceDefault, utxos: utxosDefault });
          });
          test(`getUtxosAndBalance ALL for ${descriptor} using ${discoverer.name} after ${totalMined} blocks`, () => {
            const { balance: balanceAll, utxos: utxosAll } =
              discoverer.discovery!.getUtxosAndBalance({
                descriptor,
                txStatus: TxStatus.ALL
              });
            expect(balanceAll).toEqual(totalBalance);
            expect(balanceAll).toEqual(balanceDefault);
            expect(utxosAll.length).toEqual(totalUtxosCount);
            //import & export
            expect(
              new Discovery({
                imported: discoverer.discovery!.export()
              }).getUtxosAndBalance({ descriptor, txStatus: TxStatus.ALL })
            ).toEqual({ balance: balanceAll, utxos: utxosAll });
          });
          test(`getUtxosAndBalance CONFIRMED for ${descriptor} using ${discoverer.name} after ${totalMined} blocks`, () => {
            const { balance: balanceConfirmed, utxos: utxosConfirmed } =
              discoverer.discovery!.getUtxosAndBalance({
                descriptor,
                txStatus: TxStatus.CONFIRMED
              });
            expect(balanceConfirmed).toEqual(totalMined > 0 ? totalBalance : 0);
            expect(utxosConfirmed.length).toEqual(
              totalMined > 0 ? totalUtxosCount : 0
            );
            //import & export
            expect(
              new Discovery({
                imported: discoverer.discovery!.export()
              }).getUtxosAndBalance({
                descriptor,
                txStatus: TxStatus.CONFIRMED
              })
            ).toEqual({ balance: balanceConfirmed, utxos: utxosConfirmed });
          });
          test(`getUtxosAndBalance IRREVERSIBLE for ${descriptor} using ${discoverer.name} after ${totalMined} blocks`, () => {
            const { balance: balanceIrreversible, utxos: utxosIrreversible } =
              discoverer.discovery!.getUtxosAndBalance({
                descriptor,
                txStatus: TxStatus.IRREVERSIBLE
              });
            expect(balanceIrreversible).toEqual(
              totalMined >= irrevConfThresh ? totalBalance : 0
            );
            expect(utxosIrreversible.length).toEqual(
              totalMined >= irrevConfThresh ? totalUtxosCount : 0
            );
            //import & export
            expect(
              new Discovery({
                imported: discoverer.discovery!.export()
              }).getUtxosAndBalance({
                descriptor,
                txStatus: TxStatus.IRREVERSIBLE
              })
            ).toEqual({
              balance: balanceIrreversible,
              utxos: utxosIrreversible
            });
          });
        }
      }
      const masterNode = BIP32.fromSeed(
        mnemonicToSeedSync(fixtures.regtest.mnemonic),
        network
      );
      test(`Discover standard with ${discoverer.name}`, async () => {
        await discoverer.discovery!.fetchStandardAccounts({
          masterNode,
          onAccountUsed
        });
        const accounts = discoverer.discovery!.getUsedAccounts();
        expect(accounts.length).toEqual(0);
      });
      //console.log(
      //  JSON.stringify(
      //    discoverer.discovery!.getUsedAccounts(),
      //    null,
      //    2
      //  )
      //);
      //await discoverer.discovery!.fetchTxs();
      //console.log(JSON.stringify(discoverer.discovery!.getDiscoveryInfo(), null, 2));
    }
  }
  for (const discoverer of discoverers) {
    test(`getUtxosAndBalance from non discovered expression using ${discoverer.name}`, async () => {
      const when = discoverer.discovery!.whenFetched({
        descriptor: fixtures.regtest.nonDiscoveredDescriptor
      });
      expect(when).toEqual(undefined);
      expect(() => {
        discoverer.discovery!.getUtxosAndBalance({
          descriptor: fixtures.regtest.nonDiscoveredDescriptor
        });
      }).toThrow();
    });
  }

  for (const { explorer, name } of discoverers) {
    test(`Closes ${name}`, async () => {
      expect(async () => {
        await explorer.close();
      }).not.toThrow();
    });
  }

  //test(`Invalid`, async () => {
  //  await.discoverer.discovery!.fetch({
  //});
});

vaultsTests();
