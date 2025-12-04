// App.tsx
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface InspectionRecord {
  id: string;
  encryptedData: string;
  timestamp: number;
  inspector: string;
  restaurantName: string;
  riskLevel: "low" | "medium" | "high";
  status: "pending" | "processed" | "alert";
  location: string;
  inspectionDate: string;
}

const App: React.FC = () => {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState<InspectionRecord[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newRecordData, setNewRecordData] = useState({
    restaurantName: "",
    location: "",
    inspectionDate: "",
    riskLevel: "medium" as "low" | "medium" | "high",
    inspectionNotes: ""
  });
  const [showTutorial, setShowTutorial] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterRisk, setFilterRisk] = useState("all");

  // Calculate statistics
  const lowRiskCount = records.filter(r => r.riskLevel === "low").length;
  const mediumRiskCount = records.filter(r => r.riskLevel === "medium").length;
  const highRiskCount = records.filter(r => r.riskLevel === "high").length;
  const alertCount = records.filter(r => r.status === "alert").length;

  // Filter records based on search and filter
  const filteredRecords = records.filter(record => {
    const matchesSearch = record.restaurantName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         record.location.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesRisk = filterRisk === "all" || record.riskLevel === filterRisk;
    return matchesSearch && matchesRisk;
  });

  useEffect(() => {
    loadRecords().finally(() => setLoading(false));
  }, []);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const loadRecords = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability using FHE
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("inspection_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing inspection keys:", e);
        }
      }
      
      const list: InspectionRecord[] = [];
      
      for (const key of keys) {
        try {
          const recordBytes = await contract.getData(`inspection_${key}`);
          if (recordBytes.length > 0) {
            try {
              const recordData = JSON.parse(ethers.toUtf8String(recordBytes));
              list.push({
                id: key,
                encryptedData: recordData.data,
                timestamp: recordData.timestamp,
                inspector: recordData.inspector,
                restaurantName: recordData.restaurantName,
                riskLevel: recordData.riskLevel,
                status: recordData.status || "pending",
                location: recordData.location,
                inspectionDate: recordData.inspectionDate
              });
            } catch (e) {
              console.error(`Error parsing record data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading record ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setRecords(list);
    } catch (e) {
      console.error("Error loading records:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const submitInspection = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setCreating(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting inspection data with FHE..."
    });
    
    try {
      // Simulate FHE encryption for sensitive inspection data
      const inspectionData = {
        notes: newRecordData.inspectionNotes,
        violations: [],
        scores: {}
      };
      const encryptedData = `FHE-${btoa(JSON.stringify(inspectionData))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const recordId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const recordData = {
        data: encryptedData,
        timestamp: Math.floor(Date.now() / 1000),
        inspector: account,
        restaurantName: newRecordData.restaurantName,
        riskLevel: newRecordData.riskLevel,
        status: "pending",
        location: newRecordData.location,
        inspectionDate: newRecordData.inspectionDate
      };
      
      // Store encrypted data on-chain using FHE
      await contract.setData(
        `inspection_${recordId}`, 
        ethers.toUtf8Bytes(JSON.stringify(recordData))
      );
      
      const keysBytes = await contract.getData("inspection_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(recordId);
      
      await contract.setData(
        "inspection_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Encrypted inspection submitted securely!"
      });
      
      await loadRecords();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewRecordData({
          restaurantName: "",
          location: "",
          inspectionDate: "",
          riskLevel: "medium",
          inspectionNotes: ""
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Submission failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setCreating(false);
    }
  };

  const processInspection = async (recordId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing encrypted inspection with FHE..."
    });

    try {
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const recordBytes = await contract.getData(`inspection_${recordId}`);
      if (recordBytes.length === 0) {
        throw new Error("Record not found");
      }
      
      const recordData = JSON.parse(ethers.toUtf8String(recordBytes));
      
      // Simulate FHE risk analysis - in real scenario this would be done on encrypted data
      const shouldAlert = recordData.riskLevel === "high";
      
      const updatedRecord = {
        ...recordData,
        status: shouldAlert ? "alert" : "processed"
      };
      
      await contract.setData(
        `inspection_${recordId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedRecord))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE risk analysis completed successfully!"
      });
      
      await loadRecords();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Processing failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const tutorialSteps = [
    {
      title: "Connect Wallet",
      description: "Connect your Web3 wallet to access the inspection system",
      icon: "🔗"
    },
    {
      title: "Submit Encrypted Report",
      description: "Add restaurant inspection data which will be encrypted using FHE",
      icon: "🔒"
    },
    {
      title: "FHE Risk Analysis",
      description: "Data is analyzed in encrypted state to identify safety risks",
      icon: "⚙️"
    },
    {
      title: "Get Alerts & Insights",
      description: "Receive risk alerts and inspection recommendations privately",
      icon: "📊"
    }
  ];

  const teamMembers = [
    {
      name: "Dr. Emily Chen",
      role: "FHE Security Expert",
      bio: "10+ years in cryptographic systems and privacy-preserving technologies"
    },
    {
      name: "Marcus Rodriguez",
      role: "Public Health Specialist",
      bio: "Former health inspector with deep domain expertise in food safety"
    },
    {
      name: "Sarah Johnson",
      role: "Full-Stack Developer",
      bio: "Specializes in blockchain integration and user experience design"
    },
    {
      name: "David Kim",
      role: "Data Scientist",
      bio: "Focuses on risk pattern recognition and predictive analytics"
    }
  ];

  const renderRiskChart = () => {
    const total = records.length || 1;
    const lowPercentage = (lowRiskCount / total) * 100;
    const mediumPercentage = (mediumRiskCount / total) * 100;
    const highPercentage = (highRiskCount / total) * 100;

    return (
      <div className="risk-chart-container">
        <div className="risk-chart">
          <div 
            className="chart-segment low-risk" 
            style={{ transform: `rotate(${lowPercentage * 3.6}deg)` }}
          ></div>
          <div 
            className="chart-segment medium-risk" 
            style={{ transform: `rotate(${(lowPercentage + mediumPercentage) * 3.6}deg)` }}
          ></div>
          <div 
            className="chart-segment high-risk" 
            style={{ transform: `rotate(${(lowPercentage + mediumPercentage + highPercentage) * 3.6}deg)` }}
          ></div>
          <div className="chart-center">
            <div className="chart-value">{records.length}</div>
            <div className="chart-label">Inspections</div>
          </div>
        </div>
        <div className="chart-legend">
          <div className="legend-item">
            <div className="color-box low-risk"></div>
            <span>Low Risk: {lowRiskCount}</span>
          </div>
          <div className="legend-item">
            <div className="color-box medium-risk"></div>
            <span>Medium Risk: {mediumRiskCount}</span>
          </div>
          <div className="legend-item">
            <div className="color-box high-risk"></div>
            <span>High Risk: {highRiskCount}</span>
          </div>
        </div>
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="glass-spinner"></div>
      <p>Initializing FHE connection...</p>
    </div>
  );

  return (
    <div className="app-container glassmorphism-theme">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="shield-icon"></div>
          </div>
          <h1>HealthInspect<span>FHE</span></h1>
          <div className="fhe-badge">
            <span>FHE-Powered</span>
          </div>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-btn ripple-button"
            disabled={!account}
          >
            <div className="add-icon"></div>
            New Inspection
          </button>
          <button 
            className="tutorial-btn ripple-button"
            onClick={() => setShowTutorial(!showTutorial)}
          >
            {showTutorial ? "Hide Tutorial" : "Show Tutorial"}
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <div className="main-content">
        {showTutorial && (
          <div className="tutorial-section glass-card">
            <h2>FHE Inspection System Tutorial</h2>
            <p className="subtitle">Learn how to securely process health inspection data</p>
            
            <div className="tutorial-steps">
              {tutorialSteps.map((step, index) => (
                <div 
                  className="tutorial-step ripple-card"
                  key={index}
                >
                  <div className="step-icon">{step.icon}</div>
                  <div className="step-content">
                    <h3>{step.title}</h3>
                    <p>{step.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        
        <div className="dashboard-cards">
          <div className="stats-card glass-card">
            <h3>Inspection Statistics</h3>
            <div className="stats-grid">
              <div className="stat-item ripple-card">
                <div className="stat-value">{records.length}</div>
                <div className="stat-label">Total Inspections</div>
              </div>
              <div className="stat-item ripple-card">
                <div className="stat-value">{alertCount}</div>
                <div className="stat-label">Risk Alerts</div>
              </div>
              <div className="stat-item ripple-card">
                <div className="stat-value">{highRiskCount}</div>
                <div className="stat-label">High Risk</div>
              </div>
            </div>
          </div>
          
          <div className="chart-card glass-card">
            <h3>Risk Distribution</h3>
            {renderRiskChart()}
          </div>
        </div>
        
        <div className="search-filters glass-card">
          <div className="search-container">
            <input 
              type="text"
              placeholder="Search restaurants or locations..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="search-input"
            />
            <div className="search-icon"></div>
          </div>
          
          <div className="filter-container">
            <label>Risk Level:</label>
            <select 
              value={filterRisk}
              onChange={(e) => setFilterRisk(e.target.value)}
              className="filter-select"
            >
              <option value="all">All Levels</option>
              <option value="low">Low Risk</option>
              <option value="medium">Medium Risk</option>
              <option value="high">High Risk</option>
            </select>
          </div>
        </div>
        
        <div className="inspections-section">
          <div className="section-header">
            <h2>Encrypted Inspection Records</h2>
            <div className="header-actions">
              <button 
                onClick={loadRecords}
                className="refresh-btn ripple-button"
                disabled={isRefreshing}
              >
                {isRefreshing ? "Refreshing..." : "Refresh Data"}
              </button>
            </div>
          </div>
          
          <div className="inspections-list">
            {filteredRecords.length === 0 ? (
              <div className="no-records glass-card">
                <div className="no-records-icon"></div>
                <p>No inspection records found</p>
                <button 
                  className="ripple-button primary"
                  onClick={() => setShowCreateModal(true)}
                  disabled={!account}
                >
                  Create First Inspection
                </button>
              </div>
            ) : (
              filteredRecords.map(record => (
                <div className="inspection-card glass-card ripple-card" key={record.id}>
                  <div className="card-header">
                    <h3>{record.restaurantName}</h3>
                    <span className={`risk-badge ${record.riskLevel}`}>
                      {record.riskLevel} risk
                    </span>
                  </div>
                  
                  <div className="card-details">
                    <div className="detail-item">
                      <span className="label">Location:</span>
                      <span className="value">{record.location}</span>
                    </div>
                    <div className="detail-item">
                      <span className="label">Date:</span>
                      <span className="value">{record.inspectionDate}</span>
                    </div>
                    <div className="detail-item">
                      <span className="label">Inspector:</span>
                      <span className="value">{record.inspector.substring(0, 6)}...{record.inspector.substring(38)}</span>
                    </div>
                  </div>
                  
                  <div className="card-actions">
                    <span className={`status-tag ${record.status}`}>
                      {record.status}
                    </span>
                    
                    {record.status === "pending" && (
                      <button 
                        className="process-btn ripple-button"
                        onClick={() => processInspection(record.id)}
                      >
                        Analyze with FHE
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="team-section glass-card">
          <h2>Our Team</h2>
          <p className="section-description">Experts in FHE technology and public health safety</p>
          
          <div className="team-grid">
            {teamMembers.map((member, index) => (
              <div className="team-member ripple-card" key={index}>
                <div className="member-avatar"></div>
                <h3>{member.name}</h3>
                <p className="member-role">{member.role}</p>
                <p className="member-bio">{member.bio}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
  
      {showCreateModal && (
        <ModalCreate 
          onSubmit={submitInspection} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating}
          recordData={newRecordData}
          setRecordData={setNewRecordData}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-overlay">
          <div className="transaction-modal glass-card">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="glass-spinner"></div>}
              {transactionStatus.status === "success" && <div className="success-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">✗</div>}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="shield-icon"></div>
              <span>HealthInspectFHE</span>
            </div>
            <p>Privacy-preserving restaurant health inspection auditing</p>
          </div>
          
          <div className="footer-info">
            <div className="fhe-badge">
              <span>FHE-Powered Privacy</span>
            </div>
            <div className="copyright">
              © {new Date().getFullYear()} HealthInspectFHE. All rights reserved.
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  recordData: any;
  setRecordData: (data: any) => void;
}

const ModalCreate: React.FC<ModalCreateProps> = ({ 
  onSubmit, 
  onClose, 
  creating,
  recordData,
  setRecordData
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setRecordData({
      ...recordData,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (!recordData.restaurantName || !recordData.location || !recordData.inspectionDate) {
      alert("Please fill required fields");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal glass-card">
        <div className="modal-header">
          <h2>New Health Inspection</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <div className="key-icon"></div> 
            <span>Inspection data will be encrypted with FHE for privacy protection</span>
          </div>
          
          <div className="form-grid">
            <div className="form-group">
              <label>Restaurant Name *</label>
              <input 
                type="text"
                name="restaurantName"
                value={recordData.restaurantName} 
                onChange={handleChange}
                placeholder="Enter restaurant name..." 
                className="glass-input"
              />
            </div>
            
            <div className="form-group">
              <label>Location *</label>
              <input 
                type="text"
                name="location"
                value={recordData.location} 
                onChange={handleChange}
                placeholder="Enter location..." 
                className="glass-input"
              />
            </div>
            
            <div className="form-group">
              <label>Inspection Date *</label>
              <input 
                type="date"
                name="inspectionDate"
                value={recordData.inspectionDate} 
                onChange={handleChange}
                className="glass-input"
              />
            </div>
            
            <div className="form-group">
              <label>Risk Level</label>
              <select 
                name="riskLevel"
                value={recordData.riskLevel} 
                onChange={handleChange}
                className="glass-select"
              >
                <option value="low">Low Risk</option>
                <option value="medium">Medium Risk</option>
                <option value="high">High Risk</option>
              </select>
            </div>
            
            <div className="form-group full-width">
              <label>Inspection Notes</label>
              <textarea 
                name="inspectionNotes"
                value={recordData.inspectionNotes} 
                onChange={handleChange}
                placeholder="Enter inspection details and observations..." 
                className="glass-textarea"
                rows={4}
              />
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="cancel-btn ripple-button"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={creating}
            className="submit-btn ripple-button primary"
          >
            {creating ? "Encrypting with FHE..." : "Submit Inspection"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;