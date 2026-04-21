const hre = require("hardhat");

async function main() {
    console.log("Deploying Bouncer VIP Smart Contracts to Polygon CDK...");
    
    const BouncerBadge = await hre.ethers.getContractFactory("BouncerBadge");
    const badge = await BouncerBadge.deploy();
    
    await badge.waitForDeployment();
    const address = await badge.getAddress();
    
    console.log(`BouncerBadge deployed to: ${address}`);
    
    console.log("\nVerifying on Polygonscan...");
    if (hre.network.name !== "localhost") {
        try {
            await hre.run("verify:verify", { address, constructorArguments: [] });
            console.log("Contract verified successfully");
        } catch (e) {
            console.log("Verification failed (expected on testnet):", e.message);
        }
    }
    
    console.log("\n=== Deployment Summary ===");
    console.log(`Network: ${hre.network.name}`);
    console.log(`BouncerBadge: ${address}`);
    console.log("=========================\n");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });