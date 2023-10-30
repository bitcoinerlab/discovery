# Bitcoin Descriptor Blockchain Retrieval Library

The @bitcoinerlab/discovery library, written in TypeScript, provides a method for retrieving blockchain information essential in Bitcoin wallet development and other applications that require interaction with the Bitcoin blockchain. This library enables querying of data using the *Bitcoin descriptors* syntax, facilitating retrieval of blockchain data such as balance, UTXOs, and transaction history.

## Features

- **Descriptor-Based Data Retrieval:** Retrieves transaction history for various sources, including: ranged descriptors, accounts (comprising internal & external descriptors), and addresses (a descriptor specialized for a specific index).

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
     network: networks.testnet // Specify the server's network; defaults to networks.bitcoin (mainnet) if not specified

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

   - `descriptorsCacheSize`: This property represents the cache size limit for descriptor expressions. The cache, implemented using memoizers, serves a dual purpose: it speeds up data queries by avoiding unnecessary recomputations, and it helps maintain immutability. Reaching the limit of the cache size may lead to a loss of immutability and the returned reference may change. This is not a critical issue, as the data is still correct, but it may trigger extra renders in the UI. The default value is 1000, and you can set it to 0 for unbounded caches.
   - `outputsPerDescriptorCacheSize`: This property represents the cache size limit for indices per expression, related to the number of addresses in ranged descriptor expressions. Similar to the `descriptorsCacheSize`, reaching the limit of this cache size may lead to the same immutability challenges. The default value is 10000, and you can set it to 0 for unbounded caches.

   It is important to note that the default values for `descriptorsCacheSize` and `outputsPerDescriptorCacheSize` should be sufficient for most projects. However, if you expect to work with a large number of descriptor expressions or addresses, you may need to adjust these values accordingly. Conversely, for projects that require minimal resources, you may consider reducing these values to conserve memory.

   **Note**: The `connect` method must be run before starting any data queries to the blockchain, and the `close` method should be run after you have completed all necessary queries and no longer need to query the blockchain.


4. **Using the Discovery Methods**

   Once you've instantiated the `Discovery` class, you have access to a variety of methods to fetch and derive blockchain data from *Bitcoin Output Descriptors*.
   
   Descriptor expressions are a simple language used to describe collections of Bitcoin output scripts. They enable the `Discovery` class to fetch detailed blockchain information about specific outputs. For more comprehensive insights into descriptor expressions, refer to the [BitcoinerLab descriptors module](https://bitcoinerlab.com/modules/descriptors).
   
   To initiate (or update) the data retrieval process for all addresses associated with a ranged descriptor expression, execute:
   
   ```typescript
   await discovery.fetch({ descriptor, network, gapLimit: 3 });
   ```
   
   In the code snippet above, `descriptor` refers to a single descriptor expression in string format, which can be either ranged or fixed. A ranged descriptor allows for the optional specification of an `index` to isolate a specific output within the range. It's important to note that the `index` is only applicable to ranged descriptors. When an `index` is not specified, the discovery process fetches data for all outputs encompassed by the ranged descriptor. For operations that involve multiple descriptors, `descriptors` should be used with an array of strings.
   
    **Important**: Fetch descriptor data prior to using `getUtxos`, `getBalance`, or other methods described below. An error is thrown when deriving from unfetched descriptors to prevent unexpected results. Verify fetch completion with `whenFetched` if you're unsure whether a `fetch` has been performed on a descriptor:
    
    ```typescript
    const fetchStatus = discovery.whenFetched({ descriptor, network });
    if (fetchStatus === undefined) { /* Descriptor data is not ready for use. */ }
    ```
    
    If fetch status is verified or known, proceed directly to the data derivation methods:

   - **Deriving UTXOs**:
     Use `getUtxos` to derive all unspent transaction outputs (UTXOs) from the fetched data:
     ```typescript
     const { utxos } = discovery.getUtxos({ descriptor, network });
     ```
   
   - **Calculating Balance**:
     Use `getBalance` to calculate the total balance from the fetched data:
     ```typescript
     const { balance } = discovery.getBalance({ descriptor, network });
     ```
   
   Other methods to derive or calculate data include:
   
   - **Determining the Next Index**: 
     For ranged descriptor expressions, determine the next unused index:
     ```typescript
     const index = discovery.getNextIndex({ descriptor, network });
     ```
   
   - **Identifying Descriptors by UTXO**:
     Find the descriptor that corresponds to a specific UTXO:
     ```typescript
     const descriptorData = discovery.getDescriptor({ utxo, network });
     // Returns: { descriptor, index? }, with 'index' provided for ranged descriptors.
     ```
     This is particularly useful for transaction preparation when you need to instantiate a `new Output({ descriptor })` using the descriptor associated with the UTXO, as facilitated by the [@bitcoinerlab/descriptors](https://bitcoinerlab.com/modules/descriptors) library.
   
   - **Accessing Transaction History**:
     Access all transactions associated with a specific descriptor expression (or an array of them):
     ```typescript
     const history = discovery.getHistory({ descriptors, network });
     ```

   - **Fetching Status and Timing**:
     The `whenFetched` method offers insight into whether a descriptor's outputs are currently being fetched and the timestamp of the last successful fetch:
     ```typescript
     const fetchStatus = discovery.whenFetched({ descriptor, network });
     // Returns: { fetching: boolean, timeFetched: number } or undefined if not fetched.
     ```
     This method is useful to avoid redundant network requests by checking if the data is already being fetched or has been recently updated. It works for both ranged and non-ranged descriptors and can be particularly helpful in optimizing data synchronization processes.

   
   - **Fetching Standard Accounts**:
     The `fetchStandardAccounts` method is a helper that automates the common task of retrieving or updating standard accounts (pkh, sh(wpkh), wpkh) associated with a master node, using data already fetched from the network. This method saves developers time and eliminates repetitive coding tasks.
   
     Efficiently retrieve wallet accounts with:
     ```typescript
     await discovery.fetchStandardAccounts({
       masterNode,
       gapLimit: 20, // The default gap limit
       network,
       onAccountUsed: (account) => {
         // Optional: Trigger app updates when an account with transactions is found.
       },
       onAccountChecking: (account) => {
         // Optional: Implement app-specific logic when the check for an account begins.
       }
     });
     ```
     Implement the `onAccountUsed` and `onAccountChecking` callbacks as needed for your app's functionality, such as UI updates or logging.

   For a comprehensive rundown of all methods and their detailed usage, please consult [the API documentation](https://bitcoinerlab.com/modules/discovery/api/classes/_Internal_.Discovery.html).

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
