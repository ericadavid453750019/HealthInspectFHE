// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract HealthInspectFHE is SepoliaConfig {
    struct InspectionReport {
        euint32 encryptedRestaurantId;
        euint32 encryptedHygieneScore;
        euint32 encryptedFoodSafetyScore;
        euint32 encryptedFacilityScore;
        euint32 encryptedLocationCode;
        uint256 timestamp;
    }

    struct RiskAnalysis {
        euint32 encryptedRiskScore;
        euint32 encryptedPriorityLevel;
        bool isRevealed;
    }

    struct AreaStats {
        euint32 encryptedAvgHygiene;
        euint32 encryptedRiskCount;
    }

    uint256 public reportCount;
    uint256 public analysisCount;
    mapping(uint256 => InspectionReport) public inspectionReports;
    mapping(uint256 => RiskAnalysis) public riskAnalyses;
    mapping(uint32 => AreaStats) public areaStatistics;
    mapping(uint256 => uint256) private requestToReportId;
    mapping(uint256 => uint256) private requestToAnalysisId;
    
    event ReportSubmitted(uint256 indexed reportId, uint256 timestamp);
    event AnalysisRequested(uint256 indexed reportId);
    event RiskIdentified(uint256 indexed analysisId);
    event AnalysisRevealed(uint256 indexed analysisId);

    function submitInspectionReport(
        euint32 restaurantId,
        euint32 hygieneScore,
        euint32 foodSafetyScore,
        euint32 facilityScore,
        euint32 locationCode
    ) public {
        reportCount++;
        inspectionReports[reportCount] = InspectionReport({
            encryptedRestaurantId: restaurantId,
            encryptedHygieneScore: hygieneScore,
            encryptedFoodSafetyScore: foodSafetyScore,
            encryptedFacilityScore: facilityScore,
            encryptedLocationCode: locationCode,
            timestamp: block.timestamp
        });
        emit ReportSubmitted(reportCount, block.timestamp);
    }

    function requestRiskAnalysis(uint256 reportId) public {
        require(reportId <= reportCount, "Invalid report ID");
        
        bytes32[] memory ciphertexts = new bytes32[](4);
        ciphertexts[0] = FHE.toBytes32(inspectionReports[reportId].encryptedHygieneScore);
        ciphertexts[1] = FHE.toBytes32(inspectionReports[reportId].encryptedFoodSafetyScore);
        ciphertexts[2] = FHE.toBytes32(inspectionReports[reportId].encryptedFacilityScore);
        ciphertexts[3] = FHE.toBytes32(inspectionReports[reportId].encryptedLocationCode);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.calculateRiskScore.selector);
        requestToReportId[reqId] = reportId;
        
        emit AnalysisRequested(reportId);
    }

    function calculateRiskScore(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 reportId = requestToReportId[requestId];
        require(reportId != 0, "Invalid request");

        FHE.checkSignatures(requestId, cleartexts, proof);

        uint32[] memory scores = abi.decode(cleartexts, (uint32[]));
        uint32 hygieneScore = scores[0];
        uint32 foodSafetyScore = scores[1];
        uint32 facilityScore = scores[2];
        uint32 locationCode = scores[3];

        // Simplified risk calculation
        uint32 riskScore = (100 - hygieneScore) + 
                         (100 - foodSafetyScore) + 
                         (100 - facilityScore);
        uint32 priorityLevel = riskScore > 150 ? 3 : 
                              riskScore > 100 ? 2 : 1;

        analysisCount++;
        riskAnalyses[analysisCount] = RiskAnalysis({
            encryptedRiskScore: FHE.asEuint32(riskScore),
            encryptedPriorityLevel: FHE.asEuint32(priorityLevel),
            isRevealed: false
        });

        // Update area statistics
        if (areaStatistics[locationCode].encryptedAvgHygiene == FHE.asEuint32(0)) {
            areaStatistics[locationCode] = AreaStats({
                encryptedAvgHygiene: FHE.asEuint32(0),
                encryptedRiskCount: FHE.asEuint32(0)
            });
        }

        areaStatistics[locationCode].encryptedAvgHygiene = FHE.add(
            areaStatistics[locationCode].encryptedAvgHygiene,
            FHE.asEuint32(hygieneScore)
        );

        if (riskScore > 100) {
            areaStatistics[locationCode].encryptedRiskCount = FHE.add(
                areaStatistics[locationCode].encryptedRiskCount,
                FHE.asEuint32(1)
            );
        }

        emit RiskIdentified(analysisCount);
    }

    function requestAnalysisDecryption(uint256 analysisId) public {
        require(analysisId <= analysisCount, "Invalid analysis ID");
        require(!riskAnalyses[analysisId].isRevealed, "Already revealed");
        
        bytes32[] memory ciphertexts = new bytes32[](2);
        ciphertexts[0] = FHE.toBytes32(riskAnalyses[analysisId].encryptedRiskScore);
        ciphertexts[1] = FHE.toBytes32(riskAnalyses[analysisId].encryptedPriorityLevel);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptAnalysis.selector);
        requestToAnalysisId[reqId] = analysisId;
    }

    function decryptAnalysis(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 analysisId = requestToAnalysisId[requestId];
        require(analysisId != 0, "Invalid request");

        FHE.checkSignatures(requestId, cleartexts, proof);

        uint32[] memory results = abi.decode(cleartexts, (uint32[]));
        riskAnalyses[analysisId].isRevealed = true;
        
        emit AnalysisRevealed(analysisId);
    }

    function requestAreaStats(uint32 locationCode) public {
        require(areaStatistics[locationCode].encryptedAvgHygiene != FHE.asEuint32(0), "No data for area");
        
        bytes32[] memory ciphertexts = new bytes32[](2);
        ciphertexts[0] = FHE.toBytes32(areaStatistics[locationCode].encryptedAvgHygiene);
        ciphertexts[1] = FHE.toBytes32(areaStatistics[locationCode].encryptedRiskCount);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptAreaStats.selector);
        requestToAnalysisId[reqId] = uint256(locationCode);
    }

    function decryptAreaStats(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint32 locationCode = uint32(requestToAnalysisId[requestId]);
        require(locationCode != 0, "Invalid request");

        FHE.checkSignatures(requestId, cleartexts, proof);

        uint32[] memory stats = abi.decode(cleartexts, (uint32[]));
        // Process decrypted area statistics
    }

    function getReportCount() public view returns (uint256) {
        return reportCount;
    }

    function getAnalysisStatus(uint256 analysisId) public view returns (bool) {
        return riskAnalyses[analysisId].isRevealed;
    }
}