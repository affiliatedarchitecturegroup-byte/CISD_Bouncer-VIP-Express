// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title BouncerBadge
 * @dev NFT representing security officer credentials/verification
 */
contract BouncerBadge is ERC721, ERC721URIStorage, Ownable, ReentrancyGuard {
    uint256 private _tokenIds;
    
    struct BadgeData {
        string officerId;
        string psiraGrade;
        uint256 issuedAt;
        uint256 expiresAt;
        bool isActive;
    }
    
    mapping(uint256 => BadgeData) public badgeData;
    mapping(string => uint256) public officerToToken;
    
    event BadgeMinted(address indexed to, uint256 tokenId, string officerId, string psiraGrade);
    event BadgeRevoked(uint256 tokenId);
    event BadgeRenewed(uint256 tokenId, uint256 newExpiry);
    
    constructor() ERC721("Bouncer VIP Badge", "BOUNCER") Ownable(msg.sender) {}
    
    function mintBadge(address to, string memory officerId, string memory psiraGrade, uint256 validityDays) 
        external onlyOwner returns (uint256) {
        require(officerToToken[officerId] == 0, "Badge already exists for officer");
        
        _tokenIds++;
        uint256 newTokenId = _tokenIds;
        
        _safeMint(to, newTokenId);
        
        uint256 issuedAt = block.timestamp;
        uint256 expiresAt = issuedAt + (validityDays * 1 days);
        
        badgeData[newTokenId] = BadgeData({
            officerId: officerId,
            psiraGrade: psiraGrade,
            issuedAt: issuedAt,
            expiresAt: expiresAt,
            isActive: true
        });
        
        officerToToken[officerId] = newTokenId;
        
        emit BadgeMinted(to, newTokenId, officerId, psiraGrade);
        
        return newTokenId;
    }
    
    function revokeBadge(uint256 tokenId) external onlyOwner {
        require(ownerOf(tokenId) != address(0), "Token does not exist");
        badgeData[tokenId].isActive = false;
        
        emit BadgeRevoked(tokenId);
    }
    
    function renewBadge(uint256 tokenId, uint256 additionalDays) external onlyOwner {
        require(badgeData[tokenId].expiresAt > 0, "Token does not exist");
        badgeData[tokenId].expiresAt += (additionalDays * 1 days);
        badgeData[tokenId].isActive = true;
        
        emit BadgeRenewed(tokenId, badgeData[tokenId].expiresAt);
    }
    
    function isBadgeValid(string memory officerId) external view returns (bool) {
        uint256 tokenId = officerToToken[officerId];
        if (tokenId == 0) return false;
        
        BadgeData memory data = badgeData[tokenId];
        return data.isActive && block.timestamp < data.expiresAt;
    }
    
    function getBadgeData(uint256 tokenId) external view returns (BadgeData memory) {
        require(badgeData[tokenId].issuedAt > 0, "Token does not exist");
        return badgeData[tokenId];
    }
    
    function tokenURI(uint256 tokenId) public view override(ERC721URIStorage) returns (string memory) {
        require(ownerOf(tokenId) != address(0), "Token does not exist");
        return super.tokenURI(tokenId);
    }
    
    function supportsInterface(bytes4 interfaceId) public view override(ERC721, ERC721URIStorage) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}