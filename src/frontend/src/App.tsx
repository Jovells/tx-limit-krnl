import { useState } from 'react';
import { FaWallet, FaHandHoldingHeart, FaExclamationTriangle } from 'react-icons/fa';
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt, useConnectors } from 'wagmi';
import { parseEther, formatEther, createPublicClient, http } from 'viem';
import { sepolia } from 'viem/chains';
import { contracts } from './config/wagmi';
import {ethers} from 'krnl-sdk'
import './App.css';
import Faucet from './components/Faucet';
import { isAuthorized } from './authorization';

// KRNL configuration
const KRNL_ENTRY_ID = import.meta.env.VITE_KRNL_ENTRY_ID;
const KRNL_ACCESS_TOKEN = import.meta.env.VITE_KRNL_ACCESS_TOKEN;
const KERNEL_ID = import.meta.env.VITE_TRANSACTION_LIMIT_KERNEL_ID;

function App() {
  const [donationAmount, setDonationAmount] = useState('');
  const [error, setError] = useState('');
  const [isExecutingKernel, setIsExecutingKernel] = useState(false);

  // Get account and network information
  const { address, isConnected, chainId } = useAccount();
  const connectors = useConnectors();
  const isSepolia = chainId === sepolia.id;

  const connector = connectors.find((connector) => connector.name.toLowerCase().includes('metamask')) || connectors[0]
  
  const provider = new ethers.JsonRpcProvider(import.meta.env.VITE_RPC_URL);

  // Read contract data
  const { data: tokenBalance } = useReadContract({
    address: contracts.donationToken.address,
    abi: contracts.donationToken.abi,
    functionName: 'balanceOf',
    args: [address!],
    query: {
      enabled: !!address && isSepolia,
    },
  });

  const { data: allowance } = useReadContract({
    address: contracts.donationToken.address,
    abi: contracts.donationToken.abi,
    functionName: 'allowance',
    args: [address!, contracts.limitedDonation.address],
    query: {
      enabled: !!address && isSepolia,
    },
  });

  const { data: userDonations } = useReadContract({
    address: contracts.limitedDonation.address,
    abi: contracts.limitedDonation.abi,
    functionName: 'userDonations',
    args: [address!],
    query: {
      enabled: !!address && isSepolia,
    },
  });

  const { data: totalDonations } = useReadContract({
    address: contracts.limitedDonation.address,
    abi: contracts.limitedDonation.abi,
    functionName: 'totalDonations',
    query: {
      enabled: isSepolia,
    },
  });

  const abiCoder = new ethers.AbiCoder();


  // Write contract functions
  const { writeContractAsync: approve, data: approveData } = useWriteContract();

  const { writeContractAsync: donate, data: donateData } = useWriteContract();

  // Wait for transactions
  const { isLoading: isApproving } = useWaitForTransactionReceipt({
    hash: approveData,
  });

  

  const { isLoading: isDonating } = useWaitForTransactionReceipt({
    hash: donateData,
  });

  // Execute KRNL kernel
  const executeKernel = async (amount: bigint) => {

    if (!address) return null;

    setIsExecutingKernel(true);
    try {

    
  const functionParams = abiCoder.encode(["uint256"], [amount]);
  const parameterForKernel = abiCoder.encode(["address", "uint256"], [address, amount]);

  const kernelRequestData = {
        senderAddress: address,
        kernelPayload: {
          [KERNEL_ID]: {
            functionParams: parameterForKernel
          }
        }
      };

    console.log({KRNL_ENTRY_ID, KRNL_ACCESS_TOKEN, kernelRequestData, functionParams})

   
//@ts-expect-error sdk issue
      const krnlPayload = await provider.executeKernels(KRNL_ENTRY_ID, KRNL_ACCESS_TOKEN, kernelRequestData, functionParams);
      console.log({krnlPayload});

      const decodedResponse = abiCoder.decode( ["(uint256,bytes,string)[]"], krnlPayload.kernel_responses);
      const decodedParams = abiCoder.decode( ["(uint8,bytes,string)[]"], krnlPayload.kernel_params);
      const decodedAuth = abiCoder.decode( 
              ["bytes", "bytes32", "bytes", "uint256", "bool", ]
      , krnlPayload.auth);

      const auth = await isAuthorized({
        auth: krnlPayload.auth,
        kernelParams: krnlPayload.kernel_params,
        kernelResponses: krnlPayload.kernel_responses
      }, functionParams, address);

      console.log({auth})

      const resParams = decodedParams[0][0][1];
      const resResponse = decodedResponse[0][0][1];

      console.log({resParams, resResponse})

      const decodedResParams = abiCoder.decode( ["uint256"], resParams)
      const decodedResResponse = abiCoder.decode( ["bytes"], resResponse, true)
      console.log({decodedResParams, decodedResResponse})

     


      // const decodedResResponse = abiCoder.decode( ["bool"], resResponse)

      console.log({
        resParams,
        resResponse,
        reponse: decodedResponse[0].toArray(), 
        params: decodedParams[0].toArray(),
        auth: decodedAuth.toArray(),
        // decodedResResponse
      });

      return krnlPayload;
    } catch (err) {
      console.error('Kernel execution error:', err);
      throw err;
    } finally {
      setIsExecutingKernel(false);
    }
  };

  // Make a donation
  const makeDonation = async () => {
    if (!isSepolia) {
      setError('Please connect to Sepolia network');
      return;
    }

    if (!donationAmount || parseFloat(donationAmount) <= 0) {
      setError('Please enter a valid donation amount');
      return;
    }

    setError('');
    const amount = parseEther(donationAmount);

    try {
      // Check if current allowance is sufficient
      const currentAllowance = allowance as bigint;
      if (!currentAllowance || currentAllowance < amount) {
        // Request approval only if current allowance is insufficient
        await approve({
          address: contracts.donationToken.address,
          abi: contracts.donationToken.abi,
          functionName: 'approve',
          args: [contracts.limitedDonation.address, amount],
        });
      }

      // Execute KRNL kernel
      const krnlPayload = await executeKernel(amount);
      if (!krnlPayload) {
        throw new Error('Failed to get KRNL payload');
      }



     const publicClient = createPublicClient({
        chain: sepolia,
        transport: http(sepolia.rpcUrls.default.http[0])
      })
      const args =  [{
        
        auth: krnlPayload.auth as `0x${string}`,
        kernelResponses: krnlPayload.kernel_responses as `0x${string}`,
        kernelParams: krnlPayload.kernel_params as `0x${string}`
      }, amount] as const

      let res: any 
res = await publicClient.simulateContract({
        address: contracts.limitedDonation.address,
        abi: contracts.limitedDonation.abi,
        functionName: 'donate',
        account: address,
        args
      })
      console.log({simres: res})
      res = await donate({
          address: contracts.limitedDonation.address,
          abi: contracts.limitedDonation.abi,
          functionName: 'donate',
          args
        });
      


      console.log({res});

      

      setDonationAmount('');
    } catch (err) {
      console.error('Donation error:', err);
      setError(err instanceof Error ? err.message : 'Failed to make donation');
    }
  };

  // Format address for display
  const formatAddress = (address: string) => {
    return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <header className="py-6 px-4 sm:px-6 lg:px-8 bg-white shadow-sm">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div className="flex items-center space-x-2">
            <FaHandHoldingHeart className="text-accent-600 text-2xl" />
            <h1 className="text-2xl font-bold text-gray-900">Limited Donation dApp</h1>
          </div>
          
          {!isConnected ? (
            <button
              onClick={() => connector?.connect()}
              className="btn btn-primary flex items-center space-x-2"
            >
              <FaWallet />
              <span>Connect Wallet</span>
            </button>
          ) : (
            <div className="flex items-center space-4">
              {!isSepolia && (
                <div className="flex items-center space-x-2 text-amber-600 bg-amber-50 px-3 py-1.5 rounded-full">
                  <FaExclamationTriangle />
                  <span className="text-sm font-medium">Switch to Sepolia</span>
                </div>
              )}
              <div className="flex items-center space-x-2 bg-gray-100 px-4 py-2 rounded-full">
                <FaWallet className="text-primary-600" />
                <span className="font-medium">{formatAddress(address!)}</span>
              </div>
            </div>
          )}
        </div>
      </header>
      
      <main className="max-w-7xl mx-auto py-12 px-4 sm:px-6 lg:px-8">
        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md">
            {error}
          </div>
        )}
        
        {!isConnected ? (
          <div className="text-center py-16">
            <FaHandHoldingHeart className="mx-auto text-6xl text-accent-500 mb-4" />
            <h2 className="text-3xl font-bold text-gray-900 mb-2">Welcome to Limited Donation dApp</h2>
            <p className="text-lg text-gray-600 mb-8">
              Connect your wallet to start making donations with a daily limit of 100 tokens.
            </p>
            <button
              onClick={() => connector?.connect()}
              className="btn btn-accent text-lg px-8 py-3"
            >
              Connect Wallet
            </button>
          </div>
        ) : !isSepolia ? (
          <div className="text-center py-16">
            <FaExclamationTriangle className="mx-auto text-6xl text-amber-500 mb-4" />
            <h2 className="text-3xl font-bold text-gray-900 mb-2">Wrong Network</h2>
            <p className="text-lg text-gray-600 mb-8">
              Please switch to Sepolia network to use this dApp.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="card">
              <h2 className="text-2xl font-bold text-gray-900 mb-6 flex items-center">
                <FaWallet className="mr-2 text-primary-600" />
                Your Balance
              </h2>
              
              <div className="space-y-4">
                <div className="bg-gray-50 p-4 rounded-lg">
                  <div className="text-sm text-gray-500">DonationToken Balance</div>
                  <div className="text-2xl font-bold">
                    {tokenBalance ? formatEther(tokenBalance as bigint) : '0'} DONATE
                  </div>
                </div>
                
                <div className="bg-gray-50 p-4 rounded-lg">
                  <div className="text-sm text-gray-500">Your Total Donations</div>
                  <div className="text-2xl font-bold">
                    {userDonations ? formatEther(userDonations as bigint) : '0'} DONATE
                  </div>
                </div>
                
                <Faucet />
              </div>
            </div>
            
            <div className="card">
              <h2 className="text-2xl font-bold text-gray-900 mb-6 flex items-center">
                <FaHandHoldingHeart className="mr-2 text-accent-600" />
                Make a Donation
              </h2>
              
              <div className="space-y-6">
                <div className="bg-gray-50 p-4 rounded-lg">
                  <div className="text-sm text-gray-500">Total Donations Received</div>
                  <div className="text-2xl font-bold">
                    {totalDonations ? formatEther(totalDonations as bigint) : '0'} DONATE
                  </div>
                </div>
                
                <div className="space-y-4">
                  <div>
                    <label htmlFor="donationAmount" className="block text-sm font-medium text-gray-700">
                      Donation Amount (DONATE)
                    </label>
                    <input
                      type="number"
                      id="donationAmount"
                      value={donationAmount}
                      onChange={(e) => setDonationAmount(e.target.value)}
                      placeholder="Enter amount to donate"
                      className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-accent-500 focus:ring-accent-500 text-gray-900 bg-white"
                      min="0"
                      step="0.1"
                    />
                    <p className="mt-1 text-xs text-gray-500">
                      Daily limit: 100 DONATE
                    </p>
                  </div>
                  
                  <button
                    onClick={makeDonation}
                    disabled={isApproving || isDonating || !donationAmount}
                    className="btn btn-accent w-full"
                  >
                    {isExecutingKernel ? 'Executing kernel...' : isApproving ? 'Approving...' : isDonating ? 'Processing...' : 'Make Donation'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
      
      <footer className="bg-white py-6 px-4 sm:px-6 lg:px-8 mt-auto">
        <div className="max-w-7xl mx-auto text-center text-gray-500 text-sm">
          <p>Transaction Limit Kernel & Limited Donation dApp</p>
          <p className="mt-1">Built with KRNL on Sepolia Testnet</p>
        </div>
      </footer>
    </div>
  );
}

export default App; 