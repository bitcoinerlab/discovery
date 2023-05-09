import type { Explorer } from '@bitcoinerlab/explorer';
/**
 * Represents a UTXO identifier, a combination of the transaction ID and output number.
 */
type UtxoId = string;

/**
 * Represents a UTXO (Unspent Transaction Output).
 */
type Utxo = {
  utxoId: UtxoId; // The UTXO identifier, composed of the transaction ID and the output index, separated by a colon (e.g., "txId:vout").
  txHex: string; // The transaction ID in hex format.
  vout: number; // The output index (an integer >= 0).
};

type UtxoSet = {
  index: DescriptorIndex;
  balance?: number;
  used?: boolean;
  utxos: {
    [utxoId: UtxoId]: Utxo;
  };
};

type DescriptorIndex = number | 'non-ranged';

/**
 * Represents a descriptor, which can be either a ranged descriptor or a non-ranged descriptor.
 */
interface Descriptor {
  descriptor: string; // The descriptor string in ASCII format, possibly including a wildcard (*).
  beingFetched: boolean; // A flag indicating if the descriptor data is being fetched.
  indices: {
    [K in DescriptorIndex as `${K}`]: UtxoSet;
  };
}

type NetworkId = 'bitcoin' | 'testnet' | 'regtest';

/**
 * A class to discover funds in a Bitcoin wallet using descriptors.
 */
export class Discovery {
  data: {
    [networkId: string]: {
      networkId: NetworkId; // An enum representing the network ID (e.g., 'Bitcoin', 'Testnet', or 'Regtest').
      descriptors: {
        [descriptor: string]: Descriptor; // An object containing ranged descriptors (with wildcard *) and non-ranged descriptors.
      };
    };
  };

  constructor(explorer: Explorer) {
    console.log(explorer);
    this.data = {};
  }

  //TODO: A method/util that does the BIP44, BIP49 & BIP84 very easy.

  //This was my strategy in the previous implementation for making it fast:
  /**
   * Queries an online API to get all the addresses that can be derived from
   * an HD wallet using the BIP44 format with purposes: 44, 49 and 84. It
   * returns the addresses that have been used (even if funds are currently
   * zero).
   *
   * The way this function works is as follows:
   *
   * For each LEGACY, NESTED_SEGWIT, NATIVE_SEGWIT purposes:
   *
   * It first checks if account number #0 has ever had any funds (has been used).
   * And it collects both all the addresses (derivation paths) that have been used
   * and the ones that still have funds.
   *
   * Every time that one acount number has been used, then this function tries to
   * get funds from the following account number until it cannot find used
   * accounts.
   *
   * In order to have faster account discovery, this function starts fetching
   * purposes LEGACY, NATIVE_SEGWIT and NESTED_SEGWIT in parallel.
   *
   * In addition, for each purpose, it launches the new account
   * fetching procedure as soon as the previous account fetched is detected to
   * have been used. This allows you to have a parallel lookup of addresses from
   * different accounts.
   *
   * @async
   * @param {object} params
   * @param {object} [params.network=networks.bitcoin] A {@link module:networks.networks network}.
   *
   */
}
