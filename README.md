# Bitcoin Descriptor Blockchain Retrieval Library

The @bitcoinerlab/discovery library, written in TypeScript, provides a method for retrieving blockchain information essential in Bitcoin wallet development and other applications that require interaction with the Bitcoin blockchain. This library enables querying of data using the *Bitcoin descriptors* syntax, facilitating retrieval of blockchain data such as balance, UTXOs, and transaction history.

## Features

- **Descriptor-Based Data Retrieval:** Retrieves UTXOs, transaction history, and balances for various sources: ranged descriptors, accounts (comprising internal & external descriptors), and addresses (a descriptor specialized for a specific index).

- **Transaction Status Filter:** Offers the ability to filter results by `TxStatus`: `ALL` (including transactions in the mempool), `CONFIRMED` (assuming one confirmation) and `IRREVERSIBLE` (for transactions with more than a user-defined number of confirmations).

- **Pluggable Explorer Interface:** Implements a plugin interface that separates data storage and data derivation from blockchain information retrieval, referred to as the `Explorer` interface. This design enables easy addition of various network explorers. Esplora and Electrum `Explorer` implementations have [already been implemented](https://github.com/bitcoinerlab/explorer). The slim `Explorer` interface makes it easy to add others, such as a Bitcoin Node implementation (planned for a future release).

- **Immutability Principles:** The library revolves around [Immutability](https://en.wikipedia.org/wiki/Immutable_object), which allows for quick comparisons of objects. For instance, you can retrieve the UTXOs of a certain group of ranged descriptors filtered by a particular `TxStatus`. The library will return the same reference if the result did not change, reducing the need for deep comparisons of complex data arrays. This feature greatly simplifies developing applications using reactive rendering engines such as React.

- **Data Derivation:** The library maintains a compact internal structure of information and provides methods to query and derive useful data from it. For example, Balances and UTXOs are computed on-the-fly from raw data, while advanced memoization techniques ensure efficiency. This compact data model allows the library to focus on retrieving and storing only transaction data, eliminating the need to download and keep balances or UTXOs in sync.

- **Wallet Development Support:** The library understands account syntax, providing the next available addresses for change or external retrieval, simplifying the process of wallet development.

## Important Notice

**This library is currently under active development and is not yet recommended for production use.**

**This package has a dependency on the GitHub package `@bitcoinerlab/explorer`, which is also under development and has not been published to npm yet**. You can use the script `npm run updateexplorer` to update it.

Please understand that this setup is only temporary. Once development is completed, both the `@bitcoinerlab/explorer` and `@bitcoinerlab/discovery` packages will be published to npm simultaneously. At that point, you will be able to install both packages directly from npm.

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

## Features (Coming Soon)

- Retrieve Bitcoin funds using descriptors
- Unified access to various Bitcoin blockchain explorer services
- TypeScript support for easy integration and type safety
-

## Planned Progress

- [ ] Core functionality development
- [ ] Integration with @bitcoinerlab/explorer
- [ ] Unit tests and continuous integration
- [ ] Comprehensive documentation and usage examples

Stay tuned for updates and feel free to contribute to the development of this library. Your feedback is valuable and appreciated.
