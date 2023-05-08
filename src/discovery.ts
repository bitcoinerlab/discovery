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
class Discovery {
  data: {
    [networkId: string]: {
      networkId: NetworkId; // An enum representing the network ID (e.g., 'Bitcoin', 'Testnet', or 'Regtest').
      descriptors: {
        [descriptor: string]: Descriptor; // An object containing ranged descriptors (with wildcard *) and non-ranged descriptors.
      };
    };
  };

  constructor() {
    this.data = {};
  }
}
