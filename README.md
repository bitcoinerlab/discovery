# Bitcoin Descriptor Blockchain Retrieval Library

The @bitcoinerlab/discovery library, written in TypeScript, provides a method for retrieving blockchain information essential in Bitcoin wallet development and other applications that require interaction with the Bitcoin blockchain. This library enables querying of data using the *Bitcoin descriptors* syntax, facilitating retrieval of blockchain data such as balance, UTXOs, and transaction history.

## Features

- **Descriptor-Based Data Retrieval:** Retrieves UTXOs, transaction history, and balances for various sources: ranged descriptors, accounts (comprising internal & external descriptors), and addresses (a descriptor specialized for a specific index).

- **Transaction Status Filter:** Offers the ability to filter results by `TxStatus`: `ALL` (including transactions in the mempool), `CONFIRMED` (assuming one confirmation) and `IRREVERSIBLE` (for transactions with more than a user-defined number of confirmations).

- **Pluggable Explorer Interface:** Implements a plugin interface that separates data storage and data derivation from blockchain information retrieval, referred to as the `Explorer` interface. This design enables easy addition of various network explorers. Esplora and Electrum `Explorer` implementations have [already been implemented](https://github.com/bitcoinerlab/explorer). The slim `Explorer` interface makes it easy to add others, such as a Bitcoin Node implementation (planned for a future release).

- **Immutability Principles:** The library revolves around [Immutability](https://en.wikipedia.org/wiki/Immutable_object), which allows for quick comparisons of objects. For instance, you can retrieve the UTXOs of a certain group of ranged descriptors filtered by a particular `TxStatus`. The library will return the same reference if the result did not change, reducing the need for deep comparisons of complex data arrays. This feature greatly simplifies developing applications using reactive rendering engines such as React.

- **Data Derivation:** The library maintains a compact internal structure of information and provides methods to query and derive useful data from it. For example, Balances and UTXOs are computed on-the-fly from raw data, while advanced memoization techniques ensure efficiency. This compact data model allows the library to focus on retrieving and storing only transaction data, eliminating the need to download and keep balances or UTXOs in sync.

## Usage

To get started, follow the steps below:

1. **Install the Libraries**:
   ```bash
   npm install @bitcoinerlab/explorer @bitcoinerlab/discovery bitcoinjs-lib
   ```

2. **Create the Explorer Client Instance**: 
    The explorer client is an interface to communicate with the blockchain. You can create an instance to an Electrum server or an Esplora server.

    - **Esplora** is a Blockstream-developed open-source explorer for the Bitcoin blockchain. It offers an HTTP REST API that allows interaction with the Bitcoin blockchain.

    - **Electrum** is a popular Bitcoin wallet that also provides server software (Electrum server) that facilitates communication between clients and the Bitcoin network. The Electrum server uses a different protocol than the standard Bitcoin protocol used by Esplora.

    The `@bitcoinerlab/explorer` library provides two classes for creating the explorer client instances: `EsploraExplorer` and `ElectrumExplorer`.

   ```typescript
   import { EsploraExplorer, ElectrumExplorer } from '@bitcoinerlab/explorer';
   import { networks } from 'bitcoinjs-lib';
   const esploraExplorer = new EsploraExplorer({
     url: 'https://blockstream.info/api'
   });
   const electrumExplorer = new ElectrumExplorer({
     host: 'electrum.blockstream.info',
     port: 60002,
     protocol: 'ssl', // 'ssl' and 'tcp' allowed
     network: networks.testnet // Specify the server's network; defaults to 'mainnet' if not specified

   });
   ```

    In the code snippet, we create instances for both an Electrum client and an Esplora client using the `ElectrumExplorer` and `EsploraExplorer` classes, respectively.

    Please refer to the [Explorer documentation](https://github.com/bitcoinerlab/explorer) for more details.

3. **Create the Discovery Class**:
   After creating the explorer client instance, you can create the `Discovery` class, which you will use to query the Blockchain. The `Discovery` class is created using the `DiscoveryFactory` function, passing the previously created explorer instance.

   ```typescript
   import { DiscoveryFactory } from '@bitcoinerlab/discovery';
   const { Discovery } = DiscoveryFactory(explorer); // where 'explorer' corresponds to
                                                     // 'esploraExplorer' or 'electrumExplorer' above
   await explorer.connect();
   const discovery = new Discovery();
   await explorer.close();
   ```

   The `Discovery` constructor accepts an optional object with two properties that are crucial for managing the application's memory usage:

   - `expressionsCacheSize`: This property represents the cache size limit for descriptor expressions. The cache, implemented using memoizers, serves a dual purpose: it speeds up data queries by avoiding unnecessary recomputations, and it helps maintain immutability. Reaching the limit of the cache size may lead to a loss of immutability and the returned reference may change. This is not a critical issue, as the data is still correct, but it may trigger extra renders in the UI. The default value is 1000, and you can set it to 0 for unbounded caches.
   - `indicesPerExpressionCacheSize`: This property represents the cache size limit for indices per expression, related to the number of addresses in ranged descriptor expressions. Similar to the `expressionsCacheSize`, reaching the limit of this cache size may lead to the same immutability challenges. The default value is 10000, and you can set it to 0 for unbounded caches.

   It is important to note that the default values for `expressionsCacheSize` and `indicesPerExpressionCacheSize` should be sufficient for most projects. However, if you expect to work with a large number of descriptor expressions or addresses, you may need to adjust these values accordingly. Conversely, for projects that require minimal resources, you may consider reducing these values to conserve memory.

   **Note**: The `connect` method must be run before starting any data queries to the blockchain, and the `close` method should be run after you have completed all necessary queries and no longer need to query the blockchain.

4. **Using the Discovery Methods**
   
   Once you've instantiated the `Discovery` class, you can leverage its methods to interact with blockchain data.

   For instance, if you want to fetch all the addresses from a ranged descriptor expression, execute:
   
   ```typescript
   await discovery.discover({ expressions, network, gapLimit: 3 });
   const { utxos, balance } = discovery.getUtxos({ expressions, network });
   ```
   
   In this context, the term `expressions` can be a single string or an array of strings. These expressions represent [descriptor expressions](https://bitcoinerlab.com/modules/descriptors). If an expression is ranged, it will retrieve all the related `scriptPubKeys`. Subsequently, you can obtain the UTXOs and balance for that particular expression using the subsequent line.

   Other beneficial methods include:

   - **Getting the Next Index**: 
     If you're dealing with ranged descriptor expressions and want to determine the next available (unused) index, use:
     ```typescript
     const index = discovery.getNextIndex({ expression, network });
     ```

   - **Fetching ScriptPubKeys by UTXO**:
     This method is essential post-discovery. For a given UTXO, it yields all possible `scriptPubKeys` and related data that can consume the specified UTXO. It's worth noting that this method returns an array since multiple valid descriptor expressions might refer to the same output.
     ```typescript
     discovery.getScriptPubKeysByUtxo({ utxo, network });
     // This yields: Array<{ expression, index, vout, txHex }>
     ```
     This function is particularly useful when crafting a transaction capable of expending the UTXO, especially when paired with the @bitcoinerlab/descriptors library.

   - **Reviewing Transaction History**:
     To inspect all transactions associated with a specific descriptor expression (or an array of them), use:
     ```typescript
     const history = discovery.getHistory({ expressions, network });
     ```

   For a comprehensive rundown of all available methods and their descriptions, please consult [the API documentation](https://bitcoinerlab.com/modules/descriptors/api/classes/_Internal_.Discovery.html).

## API Documentation

To generate the API documentation for this module, you can run the following command:

```bash
npm run docs
```

However, if you'd prefer to skip this step, the API documentation has already been compiled and is available for reference at [bitcoinerlab.com/modules/discovery/api](https://bitcoinerlab.com/modules/discovery/api).


## Authors and Contributors

The project was initially developed and is currently maintained by [Jose-Luis Landabaso](https://github.com/landabaso). Contributions and help from other developers are welcome.

Here are some resources to help you get started with contributing:

### Building from source

To download the source code and build the project, follow these steps:

1. Clone the repository:

```bash
git clone https://github.com/bitcoinerlab/discovery.git
```

2. Install the dependencies:

```bash
npm install
```

3. Build the project:

```bash
npm run build
```

This will build the project and generate the necessary files in the `dist` directory.

### Testing

Before finalizing and committing your code, it's essential to make sure all tests are successful. To run these tests:

1. A Bitcoin regtest node must be active.
2. Utilize the [Express-based bitcoind manager](https://github.com/bitcoinjs/regtest-server) which should be operational at `127.0.0.1:8080`.
3. An Electrum server and an Esplora server are required, both indexing the regtest node.

To streamline this setup, you can use the Docker image, `bitcoinerlab/tester`, which comes preconfigured with the required services. The Docker image can be found under **Dockerfile for bitcoinerlab/tester**. When you run the test script using:

```bash
npm test
```

it will automatically download and start the Docker image if it's not already present on your machine. However, ensure you have the `docker` binary available in your path for this to work seamlessly.

### License

This project is licensed under the MIT License.
