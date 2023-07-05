// Copyright (c) 2023 Jose-Luis Landabaso - https://bitcoinerlab.com
// Distributed under the MIT software license
// Example of a discoveryInfo object:
// const discoveryInfo = {
//   ['TESTNET']: /*NetworkInfo*/ {
//     descriptors: {
//       "pkh([73c5da0a/44'/0'/0']xpub6B.../0/*)": /*DescriptorInfo*/ {
//         fetching: true,
//         timeFetched: UNIXTIME_IN_SECONDS,
//         scriptPubKeyInfoRecords: {
//           //this is the index in ranged-descriptors. Use "non-ranged" if non-ranged
//           12: /*ScriptPubKeyInfo*/ {
//             txIds: /*Array<TxId>*/['8923a3830d9c2eac01043ec30e75b0b2b7264697660f8f...'],
//             timeFetched: UNIXTIME_IN_SECONDS
//           }
//         }
//       }
//     },
//     txInfoRecords: {
//       ['8923a3830d9c2eac01043ec30e75b0b2b7264697660f8f615c0483']: /*TxInfo*/ {
//         blockHeight: 0,
//         irreversible: false,
//         txHex?: '0100000000010115b7e9d1f6b8164a0e95544a94f5b0fbfaadc35f84...'
//       }
//     }
//   }
// };

export enum NetworkId {
  BITCOIN = 'BITCOIN',
  REGTEST = 'REGTEST',
  TESTNET = 'TESTNET',
  SIGNET = 'SIGNET'
}

export enum TxStatus {
  ALL = 'ALL',
  IRREVERSIBLE = 'IRREVERSIBLE',
  CONFIRMED = 'CONFIRMED'
}

export type TxId = string;

export type TxInfo = {
  //txId: TxId;
  blockHeight: number;
  irreversible: boolean;
  txHex?: TxHex;
};

export type ScriptPubKeyInfo = {
  //Last time the scriptPubKey was fetched
  txIds: Array<TxId>;
  timeFetched: number; //Last time explorer.fetchTxHistory was called for this scriptPubKey. 0 if never fetched - we don't need a fetching prop here since this is only a 1 network query.
};

/**
 * Represents the descriptor index for a ranged descriptor (number) or marks
 * this descriptor as non-ranged.
 */
export type Expression = string;
export type Account = Expression;
export type DescriptorIndex = number | 'non-ranged';

/**
 * Represents a descriptor, which can be either a ranged descriptor or a non-ranged descriptor.
 */
export type DescriptorInfo = {
  fetching: boolean; // A flag indicating if the descriptor data is being fetched.
  timeFetched: number; //0 if never fetched
  scriptPubKeyInfoRecords: Record<DescriptorIndex, ScriptPubKeyInfo>;
};

export type TxHex = string;

export type NetworkInfo = {
  descriptors: Record<Expression, DescriptorInfo>;
  txInfoRecords: Record<TxId, TxInfo>;
};

export type DiscoveryInfo = Record<NetworkId, NetworkInfo>;

export type Utxo = string; //`${txId}:${vout}`
