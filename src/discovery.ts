//There is a limit of 200 txs per address  in electrs:
//
//https://github.com/romanz/electrs/blob/b916c2802bdee5b9c98b420d2a93dada3cdf055e/internal/config_specification.toml#L93
//https://github.com/romanz/electrs/discussions/472
//>200 index entries, query may take too long
//
//See this address:
//1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa
//
//See this other one: 90K transactions
//19iqYbeATe4RxghQZJnYVFU4mjUUu76EA6
//
//Error in Bluewallet: Addresses with history of > 1000 transactions are not supported
//
//Fulcrum?
//
//
//
//Reimplement fetchAddress with optional param retrieveIsUsed.
//Learn from blueWallet:
//https://github.com/BlueWallet/BlueWallet/blob/master/blue_modules/BlueElectrum.js
//See tests (response too large how handled) - https://github.com/BlueWallet/BlueWallet/blob/master/tests/integration/BlueElectrum.test.js#L135
//This is when a user clicks on refresh: https://github.com/BlueWallet/BlueWallet/blob/7c9a5340a2d75fdce4d5b4f17acf5e3bb894724e/screen/wallets/transactions.js#L171
//Here is the getBalance: https://github.com/BlueWallet/BlueWallet/blob/7c9a5340a2d75fdce4d5b4f17acf5e3bb894724e/class/wallets/abstract-hd-electrum-wallet.ts#L719
//  I will need to be able to show transactions.
//  BLuewallet does not subsrcibe to addresses
//TODO: This implementation assumes that no reorgs occur or that reorgs occur
//but our tx is not affected. Maybe we should think a bit more about this.
//TODO -> implement this
//safe?: boolean; //Whether all confirmed utxos have at least SAFE_CONFIRMATIONS
//safe?: boolean; //Whether all confirmed utxos have at least SAFE_CONFIRMATIONS
//safe?: boolean; //Whether all confirmed utxos have at least SAFE_CONFIRMATIONS
//safe?: boolean; //Whether all confirmed utxos have at least SAFE_CONFIRMATIONS
//safe?: boolean; //Whether all confirmed utxos have at least SAFE_CONFIRMATIONS
//safe?: boolean; //Whether all confirmed utxos have at least SAFE_CONFIRMATIONS
//safe?: boolean; //Whether all confirmed utxos have at least SAFE_CONFIRMATIONS
//safe?: boolean; //Whether all confirmed utxos have at least SAFE_CONFIRMATIONS
//safe?: boolean; //Whether all confirmed utxos have at least SAFE_CONFIRMATIONS
//safe?: boolean; //Whether all confirmed utxos have at least SAFE_CONFIRMATIONS
//I will need to implement blockHeight to ScriptPubKeyInfo;
//I should check for reorgs somehow... Only for utxos with < 3 confs?
//I need to update API to get blockHeight
//Then I will have confirmed, unconfirmed and "safe"
//TODO: Note that blockchain.scripthash.listunspent !!! returns unconfirmed utxos
//TODO Do the same for esplora?
//utxoInfoMap should be confirmed/unconfirmedUtxoInfoMap
//
//
//
//
//TODO: reimplement discover using immer or shallow-equal
//TODO: implement discoverStandard()
//TODO: NOw that i'm at it also include unconfirmedTxCount and unconfirmedBalance
//TODO: fetchUtxos should be done after all the balances have been retrieved
//since this is a very slow procedur and anyway I don't need the utxos until
//I want to spend.
//  -> Reuse fetchScriptHash with flag fetchUtxos
//TODO: modify explorer so that fetchScriptHash also returns block_height. this is
//possible both with esplora and electrum. This is the way to know whether i
//need to re-download (not balance)
//No. fetchScriptHash can only get txCount, which is enough to know wheter there
//is new activity.
//TODO: Verify that the txCount in esplora is the same as in electrum
//block_height can be retreived from fetchUtxos
//Also, when I download again the utxos, maybe I can download them starting
//from a blockheight?
//More info here: https://electrumx.readthedocs.io/en/latest/protocol-basics.html#script-hashes
//
//Make sure this works Electrs!:
//https://github.com/romanz/electrs - extra 60G only apart from bitcoind
//https://github.com/romanz/electrs/issues/860
//
//
//
//A ver no.  Lo primero es tener balance. Si balance es 0 entonces no dscargamos
//los utxo. Lo de isUsed sigo necesitándolo joder! Porque tengo q saber si se
//usó!
//
//Como lo hace bluewallet?
//Ver esto:  async getChangeAddressAsync(): Promise<string> {
//   * Derives from hierarchy, returns next free addres
//   //https://github.com/BlueWallet/BlueWallet/blob/master/class/wallets/abstract-hd-wallet.ts
//Pero lo q tengo q saber es como diablos calcula el gap limit
//Lo que hace es llamar en cada addres a BlueElectrum.getTransactionsByAddress(address);

import * as secp256k1 from '@bitcoinerlab/secp256k1';
import * as descriptors from '@bitcoinerlab/descriptors';

import { Network, crypto } from 'bitcoinjs-lib';
import type { BIP32Interface } from 'bip32';
import type { Explorer, UtxoId, UtxoInfo } from '@bitcoinerlab/explorer';

const { Descriptor } = descriptors.DescriptorsFactory(secp256k1);

enum NetworkId {
  BITCOIN = 'BITCOIN',
  REGTEST = 'REGTEST',
  TESTNET = 'TESTNET',
  SIGNET = 'SIGNET'
}

const SAFE_CONFIRMATIONS = 3;

const getNetworkId = (network: Network): NetworkId => {
  if (network.bech32 === 'bc') return NetworkId.BITCOIN;
  if (network.bech32 === 'bcrt') return NetworkId.REGTEST;
  if (network.bech32 === 'tb') return NetworkId.TESTNET;
  if (network.bech32 === 'sb') return NetworkId.SIGNET;
  throw new Error('Unknown network');
};

/**
 * Represents an address (or more generally a scriptPubKey) including its set of
 * UTXOs and other associated metadata.
 *
 * Ideas - Electrum uses Status for a scriptHash that you can subscribe to
 * but it is undefined for mempool tx > 1 also the API will change in protocol v2
 * https://electrumx.readthedocs.io/en/latest/protocol-methods.html#blockchain-scripthash-subscribe
 * Here explains how Status is not ideal:
 * https://electrumx.readthedocs.io/en/latest/protocol-ideas.html
 *
 * We know that confirmed utxos are potentially dirty when:
 *  - getting different txCount than prev one
 *  - Or when confirmation time of the most recent record < SAFE_CONFIRMATIONS
 *
 * We don't really care about unconfirmedRecords. They will just get updated
 * anytime we update the confirmed ones or maybe once in a while by polling.
 * Electrum offers subscriptions but esplora doesn't.
 *
 * TODO: Note that in order to get next available address we must also see
 * whethet the address is being used in the mempool unless they > GAP_LIMIT
 * BlueWallet uses get_history too, so don't give a fuck if this fails...
 * https://github.com/BlueWallet/BlueWallet/blob/7c9a5340a2d75fdce4d5b4f17acf5e3bb894724e/class/wallets/abstract-hd-electrum-wallet.ts#L582
 */
type UtxoSetInfo = {
  beingFetched: boolean;
  //Last time utxos were fetched
  fetchTime: number;
  //What was the block height when the utxos were fetched
  blockHeight: number;
  //Confirmed utxos. Note that even if they are confirmed, they are not 100%
  //final as a reorg could still happen. We assume a tx is safe (final) when
  //#confirmations > SAFE_CONFIRMATIONS
  utxoInfoRecords: Record<UtxoId, UtxoInfo>;
  //unconfirmed utxos
  unconfirmedUtxoInfoRecords: Record<UtxoId, UtxoInfo>;
  //unconfirmedUtxoInfoRecords are always dirty per definition even if
  //unconfirmedTxCount != previous unconfirmedTxCount
};
type ScriptPubKeyInfo = {
  //balance will be zero if this address has txCount > 0 in the past
  //but has no more balance
  balance: number;
  //confirmed number of txs that involve this tx. Read this discussion for more
  //details: https://github.com/Blockstream/esplora/issues/221
  //TODO: maybe this should also have a possible | 'TOO_LARGE_MORE_THAN_ZERO'
  //because electrum may fail at returning a value if the list is too large
  txCount: number;
  //unconfirmed balance (in the mempool)
  unconfirmedBalance: number;
  //Same as txCount for txs in the mempool
  unconfirmedTxCount: number;
  //Last time the scriptPubKey was fetched
  fetchTime: number;
  //What was the block height last time this scriptPubKey was fetched
  blockHeight: number;
  //utxos will not be declared until they have never been retrieved.
  utxoSetInfo?: UtxoSetInfo;
};

/**
 * get the latest block height for a confirmed utxo
 * return 0 if no utxos confirmed
 */
function getUtxosBlockHeight(scriptPubKeyInfo: ScriptPubKeyInfo): number {
  if (scriptPubKeyInfo.utxoSetInfo) {
    if (scriptPubKeyInfo.utxoSetInfo.utxoInfoRecords) {
      const blockHeights = Object.values(
        scriptPubKeyInfo.utxoSetInfo.utxoInfoRecords
      ).map(utxoInfo => utxoInfo.blockHeight);
      return Math.max(...blockHeights);
    }
  }
  return 0;
}

/**
 * Given a new txCount corresponding to a previous scriptPubKeyInfo,
 * confirmed utxos are potentially dirty when:
 *  - getting different txCount than prev one
 *  - Or when confirmation time of the most recent record < SAFE_CONFIRMATIONS
 * unconfirmed utxos always need to be refreshed
 *TODO: Note that even if confirmedUtxosDirty === true this does not mean
 we should update them yet. Onlu do update them when current block hegiht increments
 for the case of same txCount. Maybe also pass blockHeight here aleady because
 we should not consider them diry if not-safe but still same block
 */
function confirmedUtxosDirty(
  txCount: number,
  blockHeight: number,
  scriptPubKeyInfo: ScriptPubKeyInfo
): boolean {
  //There's been a change in the number of confirmed txs:
  if (txCount !== scriptPubKeyInfo.txCount) return true;
  else {
    //There were not confirmed utxos yet but a new tx has been detected:
    if (txCount && !scriptPubKeyInfo.utxoSetInfo) return true;
    //This is the case when txCount has not changed. However there could have been
    //a reorg. A reorg can only affect utxos if the confirmed utxos were not safe
    //or if there were not utxos yet.
    //    -> Estudiar este caso: Tengo 10 txCount. Ese no me cambia. Justo he gastado
    //    el ultimo un utxo. Hay un reorg y vuelvo a gastar ese utxo de otra forma.
    //        -> No tengo que volver a bajarlos que mas me da
    //    -> Tengo 10 txCount. Ese no me cambia. Tengo 3 utxos no conf. Hay un reorg.
    //    Tengo que volver a descargarlo porque puede que esté teniendo otro utxos
    const utxoSetInfo = scriptPubKeyInfo.utxoSetInfo;
    const utxoCount = utxoSetInfo
      ? Object.keys(utxoSetInfo.utxoInfoRecords).length
      : 0;
    if (utxoSetInfo && utxoCount && utxoSetInfo.blockHeight !== blockHeight) {
      const utxosBlockHeight = getUtxosBlockHeight(scriptPubKeyInfo);
      if (utxosBlockHeight === 0)
        throw new Error(`BlockHeight = 0 for confirmed utxoInfoRecords`);
      const confirmations = utxoSetInfo.blockHeight - utxosBlockHeight + 1;
      if (confirmations < SAFE_CONFIRMATIONS) return true;
    }
    return false;
  }
}
/**
 * Represents the descriptor index for a ranged descriptor (number) or marks
 * this descriptor as non-ranged.
 */
type Expression = string;
type DescriptorIndex = number | 'non-ranged';

/**
 * Represents a descriptor, which can be either a ranged descriptor or a non-ranged descriptor.
 */
type DescriptorInfo = {
  expression: Expression; // The descriptor string in ASCII format, possibly including a wildcard (*).
  fetchingScriptPubKeyInfoRecords: boolean; // A flag indicating if the descriptor data is being fetched.
  descriptorFetchTime?: number;
  gapLimit?: number; //A flag indicating what was the last gapLimit used (only set for ranged descriptors)
  //Will only be set when txCount > 0
  scriptPubKeyInfoRecords?: Record<DescriptorIndex, ScriptPubKeyInfo>;
};

type NetworkInfo = {
  networkId: NetworkId; // An enum representing the network ID
  descriptorInfoRecords: Record<Expression, DescriptorInfo>;
};

type DiscoveryInfo = Record<NetworkId, NetworkInfo>;

export function DiscoveryFactory(explorer: Explorer) {
  /**
   * A class to discover funds in a Bitcoin wallet using descriptors.
   */
  class Discovery {
    discoveryInfo: DiscoveryInfo;

    /**
     * Constructs a Discovery instance.
     * @param {Explorer} explorer - The explorer instance.
     */
    constructor() {
      this.discoveryInfo = <DiscoveryInfo>{};
    }

    /**
     * Check whether this utxoId has already been discovered
     * in another part of the data structure (that does not correspond to the
     * current expression and index).
     * This check will be used to detect data failures that could lead to count
     * duplicated funds.
     * This could be the case where a ranged descriptor is used and then yet
     * again the same descriptor was put into the data pool but unranged.
     * Or the case where a descriptor is using a pubkey and another one
     * (corresponding to the same address) uses a bip32 scheme.
     */
    //TODO: reason about unconfirmedUtxoInfoMap - it should also be checked
    //probably since you don't want the same utxo existing (confirmed or not)
    utxoIdDuplicated({
      utxoId,
      networkId,
      expression,
      index
    }: {
      utxoId: UtxoId;
      networkId: NetworkId;
      expression: string;
      index: DescriptorIndex;
    }): boolean {
      const networkInfo = this.discoveryInfo[networkId];
      if (!networkInfo) return false;
      const { descriptorInfoRecords } = networkInfo;

      for (const [_expression, descriptor] of Object.entries(
        descriptorInfoRecords
      )) {
        if (descriptor.scriptPubKeyInfoRecords)
          for (const [_index, scriptPubKeyInfo] of Object.entries(
            descriptor.scriptPubKeyInfoRecords
          )) {
            if (
              scriptPubKeyInfo.utxoSetInfo?.utxoInfoRecords[utxoId] &&
              (expression !== _expression || index !== _index)
            ) {
              return true;
            }
          }
      }
      return false;
    }

    async updateScriptPubKeyInfo({
      expression,
      index,
      network,
      //updates confirmedUtxoInfoMap and unconfirmedUtxoInfoMap (if necessary)
      updateUtxos = true
    }: {
      expression: string;
      index: DescriptorIndex;
      network: Network;
      updateUtxos?: boolean;
    }): Promise<{ balance: number; txCount: number }> {
      const networkId = getNetworkId(network);
      const descriptorInfo =
        this.discoveryInfo[networkId]?.descriptorInfoRecords[expression];
      if (!descriptorInfo)
        throw new Error(`data structure not ready for ${expression}`);
      //https://electrumx.readthedocs.io/en/latest/protocol-basics.html#script-hashes

      const scriptPubKey =
        index === 'non-ranged'
          ? new Descriptor({ expression, network }).getScriptPubKey()
          : new Descriptor({ expression, network, index }).getScriptPubKey();
      const scriptHash = crypto.sha256(scriptPubKey).toString('hex');

      const prevScriptPubKeyInfo =
        descriptorInfo.scriptPubKeyInfoRecords[index];
      const { txCount, balance, unconfirmedTxCount, unconfirmedBalance } =
        await explorer.fetchScriptHash(scriptHash);

      const utxosSafelyConfirmed =
        prevScriptPubKeyInfo && txCount === prevScriptPubKeyInfo.txCount
          ? prevScriptPubKeyInfo.utxosSafelyConfirmed
          : false;

      //Note that "confirmed" utxos may change in the rare case of a reorg.
      //Even it this is rare we must take this into account.
      const updateConfirmedUtxos =
        updateUtxos && (!prevScriptPubKeyInfo || utxosSafelyConfirmed !== true);
      //As long as there are unconfirmedTxCount we must update unconf utxos even
      //if the count was the same previously since they may have been other
      //txs replaced (using RBF for instance).
      const updateUnconfirmedUtxos = updateUtxos && unconfirmedTxCount;
      console.log(updateConfirmedUtxos, updateUnconfirmedUtxos);

      if (newConfirmed && fetchUtxos) {
      } else if (newConfirmed && !fetchUtxos) {
      } else if (newUnconfirmed) {
        //Only newUnconfirmed data
      }

      //Check if fetchScriptHash detected fresh info:
      if (
        (!prevScriptPubKeyInfo && (txCount || unconfirmedTxCount)) ||
        (prevScriptPubKeyInfo &&
          (txCount !== prevScriptPubKeyInfo.txCount ||
            unconfirmedTxCount !== prevScriptPubKeyInfo.unconfirmedTxCount))
      ) {
        //This is the case where different info has been detected
        //This could be unconfirmed txs or confirmed txs

        if (
          txCount &&
          (!prevScriptPubKeyInfo || prevScriptPubKeyInfo.txCount !== txCount)
        ) {
          //This is the case where there new info includes new confirmed txs
          //Current utxos are dirty. Even if the balance did not change it may
          //be because the user received and spent the same quantity in 2 new tx

          //TODO: immer
          descriptorInfo.scriptPubKeyInfoRecords[index] = {
            txCount,
            balance,
            unconfirmedTxCount,
            unconfirmedBalance
          };
          if (updateUtxos) {
            //TODO: if balance !== utxos.balance retrigger the whole process (up to certain times)
            //It may be the case where an unspent is detected. Also, avoid infinite loops
            //and throw
            //TODO: immer
            descriptorInfo.scriptPubKeyInfoRecords[index]!.utxosBeingFetched =
              true;
            const utxoInfoMap = await explorer.fetchUtxos({ scriptHash });
            let matchingUtxoIds = 0;

            if (utxoInfoMap) {
              if (!descriptorInfo.scriptPubKeyInfoRecords[index]!.utxoInfoMap)
                //TODO: immer
                descriptorInfo.scriptPubKeyInfoRecords[index]!.utxoInfoMap =
                  utxoInfoMap;

              if (!prevScriptPubKeyInfo.utxoInfoMap) {
                newScriptPubKeyInfo.utxoInfoMap = utxoInfoMap;
              } else
                for (let utxoId in utxoInfoMap) {
                  if (prevScriptPubKeyInfo.utxoInfoMap.hasOwnProperty(utxoId)) {
                    outputObject[utxoId] = oldObject[utxoId];
                    matchingUtxoIds++;
                  } else {
                    outputObject[utxoId] = utxoInfoMap[utxoId];
                  }
                }

              if (
                matchingUtxoIds === Object.keys(oldObject).length &&
                matchingUtxoIds === Object.keys(newUtxos).length
              ) {
                outputObject = { ...oldObject };
              }
            }
            //TODO: immer 2 lines below
            descriptorInfo.scriptPubKeyInfoRecords[index].utxosBeingFetched =
              false;
            descriptorInfo.scriptPubKeyInfoRecords[index].utxosFetchTime =
              Math.floor(Date.now() / 1000);
          }
        }
        if (
          unconfirmedTxCount &&
          (!prevScriptPubKeyInfo ||
            prevScriptPubKeyInfo.unconfirmedTxCount !== unconfirmedTxCount)
        ) {
          //This is the case where there new info includes new unconfirmed txsx
        }
      }

      return { txCount, balance };
    }

    /**
     * Fetches a descriptor or descriptors and returns a Promise that
     * resolves when fetched.
     */
    async discover({
      expression,
      gapLimit = 20,
      network,
      next
    }: {
      expression: string | string[];
      gapLimit?: number;
      network: Network;
      next?: () => Promise<void>;
    }) {
      let nextPromise;
      const networkId = getNetworkId(network);
      if (!this.discoveryInfo[networkId]) {
        this.discoveryInfo[networkId] = {
          networkId,
          descriptorInfoRecords: {}
        };
      }

      const expressionArray = Array.isArray(expression)
        ? expression
        : [expression];

      for (const expression of expressionArray) {
        if (
          typeof this.discoveryInfo[networkId]!.descriptorInfoRecords[
            expression
          ] === 'undefined'
        ) {
          this.discoveryInfo[networkId]!.descriptorInfoRecords[expression] = {
            expression,
            fetchingScriptPubKeyInfoRecords: true,
            scriptPubKeyInfoRecords: <
              Record<DescriptorIndex, ScriptPubKeyInfo>
            >{}
          };
        }
        const descriptorInfo =
          this.discoveryInfo[networkId]!.descriptorInfoRecords[expression]!;
        descriptorInfo.fetchingScriptPubKeyInfoRecords = true;
        if (expression.indexOf('*') !== -1) {
          descriptorInfo.gapLimit = gapLimit;
          for (let index = 0, gap = 0; gap < gapLimit; index++) {
            const { txCount } = await this.updateScriptPubKeyInfo({
              expression,
              index,
              network
            });
            if (txCount) gap = 0;
            else gap++;
            if (txCount && next && !nextPromise) nextPromise = next();
          }
        } else {
          const { txCount } = await this.updateScriptPubKeyInfo({
            expression,
            index: 'non-ranged',
            network
          });
          if (txCount && next && !nextPromise) nextPromise = next();
        }
        descriptorInfo.fetchingScriptPubKeyInfoRecords = false;
        descriptorInfo.descriptorFetchTime = Math.floor(Date.now() / 1000);
      }
      if (nextPromise) await nextPromise;
    }

    async discoverStandard({
      masterNode,
      gapLimit = 20,
      network
    }: {
      masterNode: BIP32Interface;
      gapLimit?: number;
      network: Network;
    }) {
      const discoveryTasks = [];
      const { pkhBIP32, shWpkhBIP32, wpkhBIP32 } =
        descriptors.scriptExpressions;
      for (const expressionFn of [pkhBIP32, shWpkhBIP32, wpkhBIP32]) {
        let account = 0;
        const next = async () => {
          const expression = [0, 1].map(change =>
            expressionFn({ masterNode, network, account, change, index: '*' })
          );
          console.log('STANDARD', { expression, gapLimit, account });
          account++;
          await this.discover({ expression, gapLimit, network, next });
        };
        discoveryTasks.push(next());
      }
      await Promise.all(discoveryTasks);
    }

    getDiscoveryInfo() {
      return this.discoveryInfo;
    }
  }
  return { Discovery };
}
