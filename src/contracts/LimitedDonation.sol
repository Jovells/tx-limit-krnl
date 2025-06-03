// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {KRNL, KrnlPayload, KernelParameter, KernelResponse} from "./KRNL.sol";
import "./TransactionLimitKernel.sol";

/**
 * @title LimitedDonation
 * @dev A donation contract that uses the Transaction Limit Kernel to enforce donation limits
 */
contract LimitedDonation is KRNL {
    // The ID of the Transaction Limit Kernel in the KRNL registry
    uint256 public transactionLimitKernelId;
    
    // The address of the Transaction Limit Kernel contract
    address public transactionLimitKernelAddress;
    
    // The token used for donations
    IERC20 public donationToken;
    
    // Charity address that receives donations
    address public charityAddress;
    
    // Total donations received
    uint256 public totalDonations;
    
    // Mapping of user addresses to their total donations
    mapping(address => uint256) public userDonations;
    
    // Events
    event DonationReceived(address indexed donor, uint256 amount);
    event CharityAddressUpdated(address indexed oldAddress, address indexed newAddress);
    event KernelIdUpdated(uint256 indexed oldKernelId, uint256 indexed newKernelId);
    event KernelAddressUpdated(address indexed oldAddress, address indexed newAddress);
    
    /**
     * @dev Constructor to initialize the contract
     * @param _tokenAuthorityPublicKey Address of the token authority public key
     * @param _kernelId ID of the Transaction Limit Kernel in the KRNL registry
     * @param _kernelAddress Address of the Transaction Limit Kernel contract
     * @param _donationToken Address of the ERC20 token used for donations
     * @param _charityAddress Address that will receive the donations
     */
    constructor(
        address _tokenAuthorityPublicKey,
        uint256 _kernelId,
        address _kernelAddress,
        address _donationToken,
        address _charityAddress
    ) KRNL(_tokenAuthorityPublicKey) {
        transactionLimitKernelId = _kernelId;
        transactionLimitKernelAddress = _kernelAddress;
        donationToken = IERC20(_donationToken);
        charityAddress = _charityAddress;
    }
    
    /**
     * @dev Make a donation to the charity
     * @param krnlPayload The KRNL payload for authorization
     * @param amount Amount of tokens to donate
     * @return success True if donation was successful
     */
    function donate(
        KrnlPayload memory krnlPayload,
        uint256 amount
    ) 
        external 
        onlyAuthorized(krnlPayload, abi.encode(amount))
        returns (bool) 
    {
        // Decode response from kernel to check transaction limit
        KernelResponse[] memory kernelResponses = abi.decode(krnlPayload.kernelResponses, (KernelResponse[]));
        bool isWithinLimit = false;
        
        // Find the response for our transaction limit kernel
        for (uint i = 0; i < kernelResponses.length; i++) {
            if (kernelResponses[i].kernelId == transactionLimitKernelId) {
                // Check if there's an error
                if (bytes(kernelResponses[i].err).length > 0) {
                    revert("Kernel error: Transaction limit check failed");
                }
                
                // Decode the result (should be a boolean)
                isWithinLimit = abi.decode(kernelResponses[i].result, (bool));
                break;
            }
        }
        
        // Check if transaction is within limit
        if (!isWithinLimit) {
            revert("Donation exceeds daily limit");
        }
        
        // Transfer tokens from donor to charity
        require(donationToken.transferFrom(msg.sender, charityAddress, amount), "Token transfer failed");
        
        // Record the transaction in the kernel to track daily limits
        if (transactionLimitKernelAddress != address(0)) {
            TransactionLimitKernel(transactionLimitKernelAddress).recordTransaction(msg.sender, amount);
        }
        
        // Update donation records
        totalDonations += amount;
        userDonations[msg.sender] += amount;
        
        // Emit event
        emit DonationReceived(msg.sender, amount);
        
        return true;
    }
    
    /**
     * @dev Update the charity address (only owner)
     * @param _newCharityAddress New charity address
     */
    function updateCharityAddress(address _newCharityAddress) external onlyOwner {
        require(_newCharityAddress != address(0), "Invalid charity address");
        
        address oldAddress = charityAddress;
        charityAddress = _newCharityAddress;
        
        emit CharityAddressUpdated(oldAddress, _newCharityAddress);
    }
    
    /**
     * @dev Update the kernel ID (only owner)
     * @param _newKernelId New kernel ID
     */
    function updateKernelId(uint256 _newKernelId) external onlyOwner {
        uint256 oldKernelId = transactionLimitKernelId;
        transactionLimitKernelId = _newKernelId;
        
        emit KernelIdUpdated(oldKernelId, _newKernelId);
    }
    
    /**
     * @dev Update the kernel address (only owner)
     * @param _newKernelAddress New kernel address
     */
    function updateKernelAddress(address _newKernelAddress) external onlyOwner {
        address oldAddress = transactionLimitKernelAddress;
        transactionLimitKernelAddress = _newKernelAddress;
        
        emit KernelAddressUpdated(oldAddress, _newKernelAddress);
    }
} 