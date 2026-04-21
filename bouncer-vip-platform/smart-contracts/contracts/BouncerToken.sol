// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title BouncerToken
 * @dev ERC20 token for platform rewards and payments
 */
contract BouncerToken is ERC20, Ownable, ReentrancyGuard {
    uint256 public constant MAX_SUPPLY = 100000000 * 10**18; // 100M tokens
    
    mapping(address => bool) public minters;
    mapping(address => uint256) public stakedAmount;
    mapping(address => uint256) public stakeStartTime;
    
    event TokensMinted(address indexed to, uint256 amount);
    event Staked(address indexed user, uint256 amount);
    event Unstaked(address indexed user, uint256 amount);
    event RewardsClaimed(address indexed user, uint256 amount);
    
    constructor() ERC20("Bouncer Token", "BOUNCER") Ownable(msg.sender) {
        _mint(msg.sender, 50000000 * 10**18); // Initial supply for team
    }
    
    modifier onlyMinter() {
        require(minters[msg.sender] || msg.sender == owner(), "Not authorized to mint");
        _;
    }
    
    function addMinter(address minter) external onlyOwner {
        minters[minter] = true;
    }
    
    function removeMinter(address minter) external onlyOwner {
        minters[minter] = false;
    }
    
    function mint(address to, uint256 amount) external onlyMinter nonReentrant {
        require(totalSupply() + amount <= MAX_SUPPLY, "Exceeds max supply");
        _mint(to, amount);
        emit TokensMinted(to, amount);
    }
    
    function stake(uint256 amount) external nonReentrant {
        require(amount > 0, "Cannot stake 0");
        require(balanceOf(msg.sender) >= amount, "Insufficient balance");
        
        _transfer(msg.sender, address(this), amount);
        
        if (stakedAmount[msg.sender] == 0) {
            stakeStartTime[msg.sender] = block.timestamp;
        } else {
            _claimRewards(msg.sender);
        }
        
        stakedAmount[msg.sender] += amount;
        emit Staked(msg.sender, amount);
    }
    
    function unstake(uint256 amount) external nonReentrant {
        require(amount > 0, "Cannot unstake 0");
        require(stakedAmount[msg.sender] >= amount, "Insufficient staked amount");
        
        _claimRewards(msg.sender);
        stakedAmount[msg.sender] -= amount;
        
        _transfer(address(this), msg.sender, amount);
        
        if (stakedAmount[msg.sender] == 0) {
            stakeStartTime[msg.sender] = 0;
        }
        
        emit Unstaked(msg.sender, amount);
    }
    
    function _claimRewards(address user) internal {
        uint256 staked = stakedAmount[user];
        if (staked == 0) return;
        
        uint256 stakeDuration = block.timestamp - stakeStartTime[user];
        uint256 rewardRate = 500; // 5% APY (in basis points)
        uint256 rewards = (staked * rewardRate * stakeDuration) / (365 days * 10000);
        
        if (rewards > 0) {
            _mint(user, rewards);
            stakeStartTime[user] = block.timestamp;
            emit RewardsClaimed(user, rewards);
        }
    }
    
    function claimRewards() external nonReentrant {
        _claimRewards(msg.sender);
    }
    
    function getStakeInfo(address user) external view returns (uint256 staked, uint256 startTime, uint256 pendingRewards) {
        staked = stakedAmount[user];
        startTime = stakeStartTime[user];
        
        if (staked > 0 && startTime > 0) {
            uint256 stakeDuration = block.timestamp - startTime;
            uint256 rewardRate = 500;
            pendingRewards = (staked * rewardRate * stakeDuration) / (365 days * 10000);
        }
    }
    
    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }
}