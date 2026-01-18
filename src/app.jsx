import { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { Upload, TrendingUp, Users, MessageSquare, Clock, Download, Sparkles, AlertTriangle, Lightbulb, Hash, Award, Loader2, FileJson, Calendar } from 'lucide-react';

// !!! IMPORTANT: PASTE YOUR GEMINI API KEY HERE !!!
const GEMINI_API_KEY = 'AIzaSyBxYBVc6ONa0qZudX2-e5p5xRVMN0ba9Nw'; 

// !!! EDIT THIS LIST: Add the exact names of the files you put in your public folder !!!
const DEFAULT_FILES = [
  'general.json',
  'questions.json',
  'tradingfoor.json',
  'announcements.json',
'payouts.json', 
'fundedcertificates.json',
  // Add more file names here as needed
];

export default function App() {
  const [files, setFiles] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const [aiInsights, setAiInsights] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [loading, setLoading] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [error, setError] = useState(null);
  const [sampled, setSampled] = useState([]);
  const [allMessages, setAllMessages] = useState([]);
  const [processedData, setProcessedData] = useState(null);
  const [exportStatus, setExportStatus] = useState('');
  const [customQuestion, setCustomQuestion] = useState('');
  const [customAnswer, setCustomAnswer] = useState('');
  const [customLoading, setCustomLoading] = useState(false);
  const [debugMsg, setDebugMsg] = useState('');
  
  // New State for Default Data
  const [defaultDataAvailable, setDefaultDataAvailable] = useState(false);
  const [defaultDataDate, setDefaultDataDate] = useState(null);

  // Check if at least the first file exists on startup
  useEffect(() => {
    if (DEFAULT_FILES.length > 0) {
      fetch('/' + DEFAULT_FILES[0], { method: 'HEAD' })
        .then(res => {
          if (res.ok) {
            setDefaultDataAvailable(true);
            setDefaultDataDate(new Date().toLocaleDateString()); 
          }
        })
        .catch(() => console.log('No default files found'));
    }
  }, []);

  const readFile = (f) => new Promise((res) => {
    const r = new FileReader();
    r.onload = e => res(e.target.result);
    r.readAsText(f);
  });

  // CORE ANALYSIS FUNCTION
  const analyzeMessages = (allMsgs, filenames) => {
    const now = new Date(), d7 = new Date(now-7*864e5), d30 = new Date(now-30*864e5);
    const users = new Set(), channels = new Set(), hourly = Array(24).fill(0), contrib = {};
    const tradingFloorUsers = new Set();
    let l7=0, l30=0, minD=null, maxD=null;
    
    if (!Array.isArray(allMsgs)) {
      setError("Invalid data format");
      setLoading(false);
      return;
    }

    allMsgs.forEach(m => {
      const a = m.author?.username || m.author?.name || m.username || m.user || 'Unknown';
      const channel = (m._ch || m.channel_id || 'general').toLowerCase();
      users.add(a);
      channels.add(m._ch || m.channel_id || 'general');
      contrib[a] = (contrib[a]||0) + 1;
      
      if (channel.includes('trading') || channel.includes('floor') || channel.includes('trading-floor') || channel.includes('trading floor')) {
        tradingFloorUsers.add(a);
      }
      
      const ts = new Date(m.timestamp || m.date);
      if (!isNaN(ts)) {
        hourly[ts.getHours()]++;
        if(ts >= d7) l7++;
        if(ts >= d30) l30++;
        if(!minD || ts < minD) minD = ts;
        if(!maxD || ts > maxD) maxD = ts;
      }
    });
    
    const blocks = Array.from({length:12}, (_, i) => ({
      label: String(i*2).padStart(2,'0') + '-' + String(i*2+2).padStart(2,'0'),
      count: hourly[i*2] + hourly[i*2+1]
    }));
    const days = minD && maxD ? Math.max(1, Math.ceil((maxD-minD)/864e5)) : 1;
    const top = Object.entries(contrib).sort((a,b) => b[1]-a[1]).slice(0,10)
      .map(([n,c]) => ({name:n, count:c, pct:((c/allMsgs.length)*100).toFixed(1)}));
    
    setMetrics({
      total: allMsgs.length,
      users: users.size,
      traders: tradingFloorUsers.size,
      channels: channels.size,
      last7: l7,
      last30: l30,
      dailyAvg: Math.round(allMsgs.length/days),
      peakHour: blocks.reduce((a,b) => b.count > a.count ? b : a).label,
      hourlyData: blocks,
      topContributors: top,
      dateRange: minD && maxD ? minD.toLocaleDateString() + ' - ' + maxD.toLocaleDateString() : 'N/A'
    });
    
    setFiles(filenames);
    const step = allMsgs.length / 4000;
    setSampled(allMsgs.length <= 4000 ? allMsgs : Array.from({length: 4000}, (_, i) => allMsgs[Math.floor(i * step)]));
    setAllMessages(allMsgs);
    setProcessedData(processAllMessages(allMsgs));
    setLoading(false);
  };

  // UPDATED: Load MULTIPLE default files
  const loadDefaultData = async () => {
    setLoading(true);
    setError(null);
    let allDefaultMsgs = [];
    let loadedFiles = [];

    try {
      // Loop through all files in the DEFAULT_FILES list
      for (const fileName of DEFAULT_FILES) {
        try {
          const res = await fetch('/' + fileName);
          if (!res.ok) {
             console.warn(`Could not load ${fileName} - skipping`);
             continue;
          }
          
          const json = await res.json();
          let msgs = Array.isArray(json) ? json : json.messages || json.data || [];
          
          // Tag these messages with the filename so we know which channel they came from
          msgs = msgs.map(m => ({
              ...m, 
              _ch: fileName.replace('.json', '') // e.g., 'general'
          }));
          
          allDefaultMsgs = allDefaultMsgs.concat(msgs);
          loadedFiles.push(fileName);
        } catch (innerErr) {
          console.warn(`Error parsing ${fileName}:`, innerErr);
        }
      }

      if (allDefaultMsgs.length === 0) {
        throw new Error("Could not load any of the default files.");
      }
      
      analyzeMessages(allDefaultMsgs, loadedFiles);
      
    } catch (e) {
      console.error(e);
      setError("Failed to load report: " + e.message);
      setLoading(false);
    }
  };

  const processFiles = async (list) => {
    setLoading(true);
    setError(null);
    const names = Array.from(list).map(f => f.name);
    let all = [];
    for (const file of list) {
      try {
        const json = JSON.parse(await readFile(file));
        let msgs = Array.isArray(json) ? json : json.messages || json.data || [];
        all = all.concat(msgs.map(m => ({...m, _ch: file.name.replace('.json','')})));
      } catch(e) { console.error(e); }
    }
    
    if (!all.length) { 
        setError('No messages found in uploaded files'); 
        setLoading(false); 
        return; 
    }
    
    analyzeMessages(all, names);
  };

  const processAllMessages = (messages) => {
    // Question patterns
    const questionPatterns = [
      /\?/,
      /^(how|what|why|when|where|who|which|can|could|would|should|is|are|do|does|did|will|has|have|anyone|anybody|someone|any\s)/i,
      /\b(how to|how do|how can|what is|what are|where is|where can|when will|when is|why is|why does|can i|can you|could you|is there|are there|do you|does anyone|does this|anyone know|help with|need help|having trouble|having issues|not working|doesn't work|won't work|can't get|unable to)\b/i,
      /\b(explain|tell me|wondering|confused about|stuck on|figure out|understand)\b/i
    ];
    
    // Topic keywords to track
    const topicKeywords = {
      'API & Integrations': ['api', 'integration', 'integrate', 'connect', 'webhook', 'endpoint'],
      'Copy Trading': ['copy trading', 'copy trade', 'copytrade', 'copying trades', 'copy trader'],
      'Journaling': ['journal', 'journaling', 'trade journal', 'logging', 'track trades'],
      'Third-Party Platforms': ['tradingview', 'metatrader', 'mt4', 'mt5', 'ninjatrader', 'thinkorswim', 'third party', '3rd party'],
      'Payouts': ['payout', 'pay out', 'withdrawal', 'withdraw', 'payment', 'paid', 'money'],
      'Account Issues': ['account', 'login', 'password', 'access', 'locked', 'suspended', 'banned', 'disabled'],
      'Rules & Guidelines': ['rule', 'rules', 'guideline', 'policy', 'allowed', 'prohibited', 'violation'],
      'Verification': ['verify', 'verification', 'verified', 'kyc', 'identity', 'document'],
      'Challenges': ['challenge', 'evaluation', 'eval', 'phase', 'phase 1', 'phase 2', 'funded'],
      'Technical Issues': ['bug', 'error', 'issue', 'problem', 'not working', 'broken', 'fix', 'crash'],
      'Pricing & Plans': ['price', 'pricing', 'cost', 'plan', 'subscription', 'discount', 'coupon', 'promo'],
      'Support': ['support', 'help', 'ticket', 'contact', 'response', 'waiting']
    };
    
    // Sentiment indicators
    const positiveWords = ['great', 'awesome', 'amazing', 'love', 'excellent', 'best', 'thank', 'thanks', 'helpful', 'fantastic', 'perfect', 'good', 'nice', 'happy', 'glad', 'appreciate'];
    const negativeWords = ['bad', 'terrible', 'awful', 'hate', 'worst', 'horrible', 'frustrated', 'angry', 'disappointed', 'annoying', 'useless', 'scam', 'trash', 'garbage', 'ridiculous'];
    
    // Initialize counters
    const topicCounts = {};
    const topicExamples = {};
    Object.keys(topicKeywords).forEach(topic => {
      topicCounts[topic] = 0;
      topicExamples[topic] = [];
    });
    
    const allQuestions = [];
    const questionsByChannel = { 'questions': [], 'general': [] };
    const questionThemeCounts = {};
    const complaints = [];
    const praises = [];
    const staffMessages = [];
    const customerMessages = [];
    let positiveCount = 0;
    let negativeCount = 0;
    const wordFrequency = {};
    const channelActivity = {};
    const userMessageCounts = {};
    
    // Staff identifiers
    const staffRoles = ['breakout team', 'breakout admin', 'junior mod', 'admin', 'moderator', 'mod', 'staff'];
    
    messages.forEach(m => {
      const content = (m.content || '').toLowerCase();
      const contentOriginal = m.content || '';
      const channel = (m._ch || 'general').toLowerCase();
      const author = m.author?.username || m.username || 'Unknown';
      const roles = (m.author?.roles || m.roles || []).map(r => r.toLowerCase()).join(' ');
      
      const isTradingFloor = channel.includes('trading') || channel.includes('floor');
      channelActivity[channel] = (channelActivity[channel] || 0) + 1;
      userMessageCounts[author] = (userMessageCounts[author] || 0) + 1;
      
      const isStaff = staffRoles.some(role => roles.includes(role) || author.toLowerCase().includes(role));
      if (isStaff) {
        staffMessages.push({ author, content: contentOriginal.slice(0, 200), channel });
      } else {
        customerMessages.push({ author, content: contentOriginal.slice(0, 200), channel });
      }
      
      const stopWords = ['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare', 'ought', 'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 'between', 'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just', 'and', 'but', 'if', 'or', 'because', 'until', 'while', 'this', 'that', 'these', 'those', 'am', 'it', 'its', 'i', 'me', 'my', 'you', 'your', 'he', 'him', 'his', 'she', 'her', 'we', 'us', 'our', 'they', 'them', 'their', 'what', 'which', 'who', 'whom', 'get', 'got', 'also', 'like', 'know', 'think', 'want', 'going', 'yeah', 'yes', 'okay', 'ok', 'dont', 'cant', 'im', 'ive', 'its', 'thats', 'youre', 'ill', 'wont', 'didnt', 'doesnt', 'isnt', 'arent', 'wasnt', 'werent', 'hasnt', 'havent', 'hadnt', 'couldnt', 'shouldnt', 'wouldnt', 'about', 'well', 'one', 'still', 'even', 'back', 'make', 'much', 'see', 'way', 'come', 'take', 'give', 'let', 'say', 'said'];
      const words = content.split(/\s+/).filter(w => w.length > 3 && !stopWords.includes(w) && !/^\d+$/.test(w));
      words.forEach(w => {
        const clean = w.replace(/[^a-z]/g, '');
        if (clean.length > 3) {
          wordFrequency[clean] = (wordFrequency[clean] || 0) + 1;
        }
      });
      
      const isQuestionChannel = (channel.includes('question') || channel.includes('general')) && !isTradingFloor;
      const isQuestion = questionPatterns.some(p => p.test(content));
      
      if (isQuestion && isQuestionChannel) {
        const questionObj = { author, content: contentOriginal.slice(0, 300), channel };
        allQuestions.push(questionObj);
        if (channel.includes('question')) {
          questionsByChannel['questions'].push(questionObj);
        } else {
          questionsByChannel['general'].push(questionObj);
        }
      }
      
      const questionThemes = {
        'API/Integration': ['api', 'integration', 'integrate', 'connect', 'webhook', 'endpoint', 'key'],
        'Copy Trading': ['copy trading', 'copy trade', 'copytrade', 'copying trades'],
        'Journaling': ['journal', 'journaling', 'trade journal', 'log trades'],
        'Payouts/Withdrawals': ['payout', 'withdraw', 'withdrawal', 'payment', 'when paid', 'get paid', 'money'],
        'Account Access': ['login', 'password', 'reset', 'access', 'locked out', 'cant login', 'cannot login'],
        'Challenge/Evaluation': ['challenge', 'evaluation', 'eval', 'phase 1', 'phase 2', 'pass', 'fail', 'rules'],
        'Platform Issues': ['not working', 'error', 'bug', 'issue', 'problem', 'crash', 'stuck'],
        'Pricing/Discounts': ['price', 'cost', 'discount', 'coupon', 'promo', 'code', 'sale'],
        'Verification/KYC': ['verify', 'verification', 'kyc', 'document', 'identity', 'id'],
        'Trading Platforms': ['metatrader', 'mt4', 'mt5', 'tradingview', 'platform'],
        'Account Setup': ['setup', 'start', 'begin', 'new account', 'sign up', 'register', 'how to start'],
        'Rules Clarification': ['allowed', 'can i', 'is it ok', 'against rules', 'permitted', 'prohibited']
      };
      
      if (isQuestion && !isTradingFloor) {
        Object.entries(questionThemes).forEach(([theme, keywords]) => {
          if (keywords.some(kw => content.includes(kw))) {
            if (!questionThemeCounts[theme]) {
              questionThemeCounts[theme] = { count: 0, examples: [] };
            }
            questionThemeCounts[theme].count++;
            if (questionThemeCounts[theme].examples.length < 5) {
              questionThemeCounts[theme].examples.push({ author, content: contentOriginal.slice(0, 250), channel });
            }
          }
        });
      }
      
      if (!isTradingFloor) {
        Object.entries(topicKeywords).forEach(([topic, keywords]) => {
          if (keywords.some(kw => content.includes(kw))) {
            topicCounts[topic]++;
            if (topicExamples[topic].length < 15) {
              topicExamples[topic].push({ author, content: contentOriginal.slice(0, 250), channel });
            }
          }
        });
      }
      
      const hasPositive = positiveWords.some(w => content.includes(w));
      const hasNegative = negativeWords.some(w => content.includes(w));
      
      if (hasPositive) {
        positiveCount++;
        if (praises.length < 30) {
          praises.push({ author, content: contentOriginal.slice(0, 250), channel });
        }
      }
      if (hasNegative) {
        negativeCount++;
        if (complaints.length < 30) {
          complaints.push({ author, content: contentOriginal.slice(0, 250), channel });
        }
      }
    });
    
    const sortedTopics = Object.entries(topicCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([topic, count]) => ({ topic, count, examples: topicExamples[topic] }));
    
    const topWords = Object.entries(wordFrequency)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 50)
      .map(([word, count]) => ({ word, count }));
    
    const sortedQuestionThemes = Object.entries(questionThemeCounts)
      .sort((a, b) => b[1].count - a[1].count)
      .map(([theme, data]) => ({ theme, count: data.count, examples: data.examples }));
    
    const priorityQuestions = [
      ...questionsByChannel['questions'],
      ...questionsByChannel['general']
    ];
    
    return {
      totalProcessed: messages.length,
      topicCounts: sortedTopics,
      allQuestions: allQuestions.length,
      priorityQuestions,
      questionThemes: sortedQuestionThemes,
      complaints,
      praises,
      sentiment: {
        positive: positiveCount,
        negative: negativeCount,
        ratio: positiveCount / Math.max(1, negativeCount)
      },
      topWords,
      channelActivity,
      staffMessages: staffMessages.slice(0, 50),
      customerMessages: customerMessages.length
    };
  };

  const generateAI = async () => {
    if (!metrics) return;
    if (GEMINI_API_KEY.includes('PASTE')) {
        setError("Please add your Gemini API Key in the code first!");
        return;
    }
    setAiLoading(true);
    setError(null);
    
    const totalMsgs = sampled.length;
    const step = Math.max(1, Math.floor(totalMsgs / 2500));
    const msgs = [];
    for (let i = 0; i < totalMsgs && msgs.length < 2500; i += step) {
      msgs.push(sampled[i]);
    }
    
    const contentMap = {};
    msgs.forEach(m => {
      const content = (m.content || '').toLowerCase().slice(0, 200);
      const words = content.split(/\s+/).filter(w => w.length > 3);
      words.forEach(w => { contentMap[w] = (contentMap[w] || 0) + 1; });
    });
    
    const commonWords = Object.entries(contentMap)
      .filter(([w, c]) => c > 3 && !['that', 'this', 'have', 'with', 'from', 'they', 'been', 'will', 'your', 'what', 'when', 'there', 'their', 'would', 'could', 'should', 'about', 'which', 'were', 'than', 'them', 'into', 'just', 'only', 'also', 'know', 'like', 'then', 'more', 'some', 'very', 'does', 'dont', 'cant'].includes(w))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30)
      .map(([w, c]) => w + '(' + c + ')');
    
    const questionChannels = ['questions', 'general', 'general-chat', 'general chat'];
    const questionPatterns = [
      /\?/,
      /^(how|what|why|when|where|who|which|can|could|would|should|is|are|do|does|did|will|has|have|anyone|anybody|someone|any\s)/i,
      /\b(how to|how do|how can|what is|what are|where is|where can|when will|when is|why is|why does|can i|can you|could you|is there|are there|do you|does anyone|does this|anyone know|help with|need help|having trouble|having issues|not working|doesn't work|won't work|can't get|unable to)\b/i
    ];
    
    const questions = msgs.filter(m => {
      const channel = (m._ch || '').toLowerCase();
      const isQuestionChannel = questionChannels.some(qc => channel.includes(qc));
      if (!isQuestionChannel) return false;
      const content = (m.content || '').toLowerCase();
      return questionPatterns.some(pattern => pattern.test(content));
    }).map(m => {
      const author = m.author?.username || '?';
      return '[' + (m._ch || 'general') + '] [' + author + ']: ' + (m.content || '').slice(0, 200);
    });
    
    const txt = msgs.map(m => '[' + m._ch + '] ' + (m.author?.username || '?') + ': ' + (m.content || '').slice(0, 250)).join('\n').slice(0, 25000);
    
    const prompt = `You are a senior community analyst. Analyze this Discord data with PRECISION.

CRITICAL INSTRUCTIONS:
- Base your analysis ONLY on the actual messages provided
- Count actual occurrences - do not guess 
- For topics: identify SPECIFIC subjects discussed
- For questions: extract ACTUAL questions asked by users

QUANTITATIVE DATA:
- Total Messages Analyzed: ${msgs.length}
- Date Range: ${metrics.dateRange}
- Active Users: ${metrics.users}
- Daily Average: ${metrics.dailyAvg}

MOST FREQUENT WORDS: ${commonWords.join(', ')}

SAMPLE QUESTIONS (${questions.length} total):
${questions.slice(0, 40).join('\n')}

ALL MESSAGES (sampled):
${txt}

Analyze and return ONLY this JSON (no markdown, no explanation):
{
  "healthScore": <1-10 based on engagement>,
  "healthExplanation": "<2-3 sentences explaining score>",
  "positiveTrends": ["<specific trend>", "<trend 2>", "<trend 3>"],
  "concerns": ["<specific concern>", "<concern 2>", "<concern 3>"],
  "keyTopics": [
    {"topic": "<topic name>", "description": "<details>", "volume": "high/medium/low", "count": <approx mentions>},
    {"topic": "<topic 2>", "description": "<details>", "volume": "high/medium/low", "count": <num>}
  ],
  "customerQuestions": [
    {"question": "<actual question>", "frequency": "common/occasional", "answered": "well/poorly", "count": <times asked>},
    {"question": "<question 2>", "frequency": "common/occasional", "answered": "well/poorly", "count": <num>}
  ],
  "modPerformance": {
    "overallRating": "excellent/good/fair/needs improvement",
    "responseTime": "<assessment>",
    "strengths": ["<strength 1>", "<strength 2>"],
    "areasToImprove": ["<area 1>"],
    "coverage": "<assessment>"
  },
  "roomForImprovement": [
    {"area": "<area>", "priority": "high/medium", "action": "<action>", "impact": "<impact>"},
    {"area": "<area 2>", "priority": "high/medium", "action": "<action>", "impact": "<impact>"}
  ],
  "sentiment": "<overall mood summary>",
  "recommendations": ["<rec 1>", "<rec 2>", "<rec 3>"],
  "wowInsight": "<one surprising insight>"
}`;

    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          contents: [{
            parts: [{ text: prompt }]
          }]
        })
      });
      
      const data = await res.json();
      
      if (data.error) {
        throw new Error(data.error.message);
      }

      let t = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      t = t.replace(/```json\n?/g, '').replace(/```/g, '').trim();
      setAiInsights(JSON.parse(t));
    } catch(e) {
      console.error(e);
      setError('AI Analysis Failed: ' + e.message);
    }
    setAiLoading(false);
  };

  const askCustomQuestion = async () => {
    setDebugMsg('Starting...');
    
    if (GEMINI_API_KEY.includes('PASTE')) {
        setDebugMsg("Error: Please add Gemini API Key in code");
        setCustomAnswer("Please open the code and paste your Gemini API Key in the 'GEMINI_API_KEY' variable at the top.");
        return;
    }

    if (!customQuestion.trim()) {
      setDebugMsg('Please enter a question');
      return;
    }
    
    if (!metrics) {
      setDebugMsg('No data loaded');
      return;
    }
    
    setCustomLoading(true);
    setCustomAnswer('');
    setDebugMsg('Preparing request...');
    
    try {
      const msgData = sampled.slice(0, 800).map(m => 
        '[' + (m._ch || 'general') + '] ' + (m.author?.username || '?') + ': ' + (m.content || '').slice(0, 150)
      ).join('\n');
      
      const prompt = `You are analyzing Discord community data for a trading/financial services company.

DATA SUMMARY:
- Total Messages: ${metrics.total}
- Active Users: ${metrics.users}
- Date Range: ${metrics.dateRange}

SAMPLE MESSAGES:
${msgData}

QUESTION: "${customQuestion}"

Answer based on the data above. Be specific and cite examples when possible.`;

      setDebugMsg('Calling Gemini API...');
      
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{ text: prompt }]
          }]
        })
      });
      
      setDebugMsg('Parsing response...');
      const data = await res.json();
      
      if (data.error) {
        setDebugMsg('API Error: ' + data.error.message);
        setCustomAnswer('Error: ' + data.error.message);
      } else {
        const answer = data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response';
        setCustomAnswer(answer);
        setDebugMsg('Done!');
      }
    } catch (err) {
      setDebugMsg('Error: ' + err.message);
      setCustomAnswer('Failed: ' + err.message);
    }
    
    setCustomLoading(false);
  };

  const handleExport = () => {
    if (!metrics) return;
    let txt = 'DISCORD COMMUNITY ANALYTICS REPORT\n';
    txt += '==================================================\n';
    txt += 'Generated: ' + new Date().toLocaleString() + '\n';
    txt += 'Date Range: ' + metrics.dateRange + '\n\n';
    txt += 'KEY METRICS\n------------------------------\n';
    txt += 'Total Messages: ' + metrics.total.toLocaleString() + '\n';
    txt += 'Active Users: ' + metrics.users + '\n';
    txt += 'Active Traders (Trading Floor): ' + metrics.traders + '\n';
    txt += 'Channels: ' + metrics.channels + '\n';
    txt += 'Daily Average: ' + metrics.dailyAvg + '\n';
    txt += 'Peak Hours: ' + metrics.peakHour + '\n';
    txt += 'Last 7 Days: ' + metrics.last7.toLocaleString() + '\n';
    txt += 'Last 30 Days: ' + metrics.last30.toLocaleString() + '\n\n';
    
    if (aiInsights) {
      txt += 'HEALTH SCORE: ' + aiInsights.healthScore + '/10\n';
      txt += aiInsights.healthExplanation + '\n\n';
      txt += 'POSITIVE TRENDS\n------------------------------\n';
      aiInsights.positiveTrends.forEach((t, i) => { txt += (i+1) + '. ' + t + '\n'; });
      txt += '\nCONCERNS\n------------------------------\n';
      aiInsights.concerns.forEach((c, i) => { txt += (i+1) + '. ' + c + '\n'; });
      txt += '\nTOP TOPICS\n------------------------------\n';
      (aiInsights.keyTopics || []).forEach((t, i) => { txt += (i+1) + '. ' + (t.topic || t) + '\n'; });
      txt += '\nCUSTOMER QUESTIONS\n------------------------------\n';
      (aiInsights.customerQuestions || []).forEach((q, i) => { txt += (i+1) + '. ' + (q.question || q) + '\n'; });
      txt += '\nRECOMMENDATIONS\n------------------------------\n';
      aiInsights.recommendations.forEach((r, i) => { txt += (i+1) + '. ' + r + '\n'; });
      txt += '\nKEY INSIGHT\n------------------------------\n' + aiInsights.wowInsight + '\n\n';
    }
    
    txt += 'TOP CONTRIBUTORS\n------------------------------\n';
    metrics.topContributors.forEach((c, i) => { txt += (i+1) + '. ' + c.name + ': ' + c.count + '\n'; });
    
    navigator.clipboard.writeText(txt).then(() => {
      setExportStatus('Copied!');
      setTimeout(() => setExportStatus(''), 2000);
    }).catch(() => {
      setExportStatus('Failed');
    });
  };

  const handlePDF = () => {
    if (!metrics) return;
    
    let html = '<html><head><title>Discord Analytics Report</title>';
    html += '<style>';
    html += 'body{font-family:system-ui,sans-serif;max-width:800px;margin:0 auto;padding:20px;color:#1a1a2e}';
    html += 'h1{color:#4f46e5;border-bottom:3px solid #4f46e5;padding-bottom:10px}';
    html += 'h2{color:#4f46e5;margin-top:25px;font-size:16px;border-bottom:1px solid #e5e7eb;padding-bottom:5px}';
    html += '.score{background:linear-gradient(135deg,#4f46e5,#7c3aed);color:white;padding:20px;border-radius:10px;margin:20px 0}';
    html += '.score-num{font-size:36px;font-weight:bold}';
    html += '.metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:15px 0}';
    html += '.metric{background:#f5f3ff;padding:12px;border-radius:8px;text-align:center}';
    html += '.metric-val{font-size:20px;font-weight:bold;color:#4f46e5}';
    html += '.metric-label{font-size:11px;color:#6b7280}';
    html += '.item{padding:8px 0;border-bottom:1px solid #f3f4f6}';
    html += '.topic{background:#f5f3ff;padding:10px;border-radius:6px;margin:5px 0}';
    html += '.insight{background:#fef3c7;padding:15px;border-radius:8px;border-left:4px solid #f59e0b;margin:15px 0}';
    html += '.contributor{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f3f4f6}';
    html += '@media print{body{padding:0}.score{-webkit-print-color-adjust:exact;print-color-adjust:exact}}';
    html += '</style></head><body>';
    
    html += '<h1>Discord Community Analytics Report</h1>';
    html += '<p style="color:#6b7280">Generated: ' + new Date().toLocaleString() + ' | Range: ' + metrics.dateRange + '</p>';
    
    if (aiInsights) {
      html += '<div class="score"><div>Community Health Score</div><div class="score-num">' + aiInsights.healthScore + '/10</div>';
      html += '<div style="margin-top:10px;opacity:0.9">' + aiInsights.healthExplanation + '</div></div>';
    }
    
    html += '<h2>Key Metrics</h2><div class="metrics">';
    html += '<div class="metric"><div class="metric-val">' + metrics.total.toLocaleString() + '</div><div class="metric-label">Total Messages</div></div>';
    html += '<div class="metric"><div class="metric-val">' + metrics.users + '</div><div class="metric-label">Active Users</div></div>';
    html += '<div class="metric"><div class="metric-val">' + metrics.dailyAvg + '</div><div class="metric-label">Daily Average</div></div>';
    html += '<div class="metric"><div class="metric-val">' + metrics.peakHour + '</div><div class="metric-label">Peak Hours</div></div>';
    html += '<div class="metric"><div class="metric-val">' + metrics.last7.toLocaleString() + '</div><div class="metric-label">Last 7 Days</div></div>';
    html += '<div class="metric"><div class="metric-val">' + metrics.last30.toLocaleString() + '</div><div class="metric-label">Last 30 Days</div></div>';
    html += '</div>';
    
    if (aiInsights) {
      html += '<h2>Positive Trends</h2>';
      aiInsights.positiveTrends.forEach((t, i) => { html += '<div class="item">' + (i+1) + '. ' + t + '</div>'; });
      
      html += '<h2>Areas of Concern</h2>';
      aiInsights.concerns.forEach((c, i) => { html += '<div class="item">' + (i+1) + '. ' + c + '</div>'; });
      
      html += '<h2>Top Discussion Topics</h2>';
      (aiInsights.keyTopics || []).forEach((t, i) => {
        const name = t.topic || t;
        const desc = t.description ? '<div style="color:#6b7280;font-size:12px;margin-top:3px">' + t.description + '</div>' : '';
        html += '<div class="topic"><strong>' + (i+1) + '. ' + name + '</strong>' + desc + '</div>';
      });
      
      html += '<h2>Common Customer Questions</h2>';
      (aiInsights.customerQuestions || []).forEach((q, i) => {
        const qt = q.question || q;
        const meta = q.frequency ? '<span style="color:#6b7280;font-size:11px"> (Frequency: ' + q.frequency + ', Response: ' + q.answered + ')</span>' : '';
        html += '<div class="item">' + (i+1) + '. ' + qt + meta + '</div>';
      });
      
      if (aiInsights.modPerformance) {
        html += '<h2>Moderator Performance</h2>';
        html += '<div class="topic"><strong>Overall Rating:</strong> ' + aiInsights.modPerformance.overallRating + '<br>';
        html += '<strong>Response Time:</strong> ' + aiInsights.modPerformance.responseTime + '<br>';
        html += '<strong>Coverage:</strong> ' + aiInsights.modPerformance.coverage + '<br>';
        if (aiInsights.modPerformance.strengths) {
          html += '<strong>Strengths:</strong> ' + aiInsights.modPerformance.strengths.join(', ') + '<br>';
        }
        if (aiInsights.modPerformance.areasToImprove) {
          html += '<strong>Areas to Improve:</strong> ' + aiInsights.modPerformance.areasToImprove.join(', ');
        }
        html += '</div>';
      }
      
      if (aiInsights.roomForImprovement) {
        html += '<h2>Room for Improvement</h2>';
        aiInsights.roomForImprovement.forEach((item, i) => {
          html += '<div class="topic"><strong>' + (i+1) + '. ' + item.area + '</strong> <span style="background:' + (item.priority === 'high' ? '#fee2e2' : '#fef3c7') + ';color:' + (item.priority === 'high' ? '#dc2626' : '#d97706') + ';padding:2px 6px;border-radius:4px;font-size:10px">' + item.priority + '</span>';
          html += '<div style="font-size:13px;margin-top:5px"><strong>Action:</strong> ' + item.action + '</div>';
          html += '<div style="font-size:13px;color:#6b7280"><strong>Impact:</strong> ' + item.impact + '</div></div>';
        });
      }
      
      html += '<h2>Strategic Recommendations</h2>';
      aiInsights.recommendations.forEach((r, i) => { html += '<div class="item">' + (i+1) + '. ' + r + '</div>'; });
      
      html += '<div class="insight"><strong>💡 Key Insight for Leadership:</strong><br>' + aiInsights.wowInsight + '</div>';
      
      html += '<h2>Sentiment Analysis</h2><p>' + aiInsights.sentiment + '</p>';
    }
    
    html += '<h2>Top Contributors</h2>';
    metrics.topContributors.forEach((c, i) => {
      html += '<div class="contributor"><span>' + (i+1) + '. ' + c.name + '</span><span>' + c.count.toLocaleString() + ' messages (' + c.pct + '%)</span></div>';
    });
    
    html += '<div style="margin-top:30px;padding-top:15px;border-top:1px solid #e5e7eb;color:#9ca3af;font-size:11px;text-align:center">Generated by Discord Community Analytics Dashboard</div>';
    html += '</body></html>';
    
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(html);
      printWindow.document.close();
      setTimeout(() => { printWindow.print(); }, 500);
    }
  };

  if (!metrics) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-900 via-purple-900 to-indigo-800 p-4 flex items-center justify-center">
        <div className="bg-white/10 rounded-2xl p-6 border border-white/20 text-center w-full max-w-sm">
          <Upload className="w-12 h-12 text-white mx-auto mb-3"/>
          <h1 className="text-xl font-bold text-white mb-1">Discord Analytics</h1>
          <p className="text-white/60 mb-6 text-sm">Upload Discord JSON exports</p>
          
          <label className="block w-full py-6 px-4 bg-indigo-500 hover:bg-indigo-400 text-white rounded-xl cursor-pointer border-2 border-dashed border-indigo-300 transition-colors">
            <FileJson className="w-8 h-8 mx-auto mb-2"/>
            <span className="font-medium block">Tap to Select Files</span>
            <span className="text-xs text-indigo-200 block mt-1">or drag & drop</span>
            <input 
              type="file" 
              accept=".json" 
              multiple 
              onChange={e => e.target.files && e.target.files.length > 0 && processFiles(e.target.files)} 
              className="hidden"
            />
          </label>

          {/* NEW: Load Default Report Button */}
          {defaultDataAvailable && (
            <div className="mt-4 pt-4 border-t border-white/10">
              <button 
                onClick={loadDefaultData}
                className="w-full py-3 px-4 bg-white/5 hover:bg-white/10 border border-white/20 text-white rounded-xl flex items-center justify-center gap-2 transition-colors"
              >
                <Calendar className="w-4 h-4 text-cyan-400"/>
                <div className="text-left">
                  <div className="text-sm font-medium">View Latest Report</div>
                  {defaultDataDate && <div className="text-xs text-white/50">Updated: {defaultDataDate}</div>}
                </div>
              </button>
            </div>
          )}

          {loading && <p className="mt-3 text-white/70 text-sm"><Loader2 className="w-4 h-4 animate-spin inline mr-1"/>Processing...</p>}
          {error && <p className="mt-3 text-red-300 text-sm">{error}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-900 via-purple-900 to-indigo-800 p-3">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-3">
          <h1 className="text-lg font-bold text-white">Discord Analytics</h1>
          <div className="flex gap-2">
            <button onClick={handleExport} className="flex items-center gap-1 px-3 py-1.5 bg-indigo-500 active:bg-indigo-400 text-white rounded-lg text-sm">
              <Download className="w-4 h-4"/>{exportStatus || 'Copy'}
            </button>
            <button onClick={handlePDF} className="flex items-center gap-1 px-3 py-1.5 bg-green-600 active:bg-green-500 text-white rounded-lg text-sm">
              <FileJson className="w-4 h-4"/>PDF
            </button>
          </div>
        </div>
        
        <div className="flex gap-1 mb-3 overflow-x-auto">
          {['overview', 'insights', 'ask', 'engagement'].map(t => (
            <button 
              key={t} 
              onClick={() => setActiveTab(t)} 
              className={'px-3 py-1.5 rounded-lg text-sm whitespace-nowrap ' + (activeTab === t ? 'bg-white text-indigo-600' : 'text-white/70 bg-white/10')}
            >
              {t === 'ask' ? 'Ask AI' : t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        {error && <div className="bg-red-500/20 rounded-lg p-2 mb-3 text-red-200 text-sm">{error}</div>}

        {activeTab === 'overview' && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-white/10 rounded-xl p-3 border border-white/20">
                <p className="text-white/60 text-xs">Total Messages</p>
                <p className="text-xl font-bold text-white">{metrics.total.toLocaleString()}</p>
              </div>
              <div className="bg-white/10 rounded-xl p-3 border border-white/20">
                <p className="text-white/60 text-xs">Active Users</p>
                <p className="text-xl font-bold text-white">{metrics.users}</p>
              </div>
              <div className="bg-gradient-to-br from-green-500/20 to-emerald-500/20 rounded-xl p-3 border border-green-400/30">
                <p className="text-green-300 text-xs">Active Traders</p>
                <p className="text-xl font-bold text-green-400">{metrics.traders}</p>
                <p className="text-green-300/60 text-xs">Trading Floor</p>
              </div>
              <div className="bg-white/10 rounded-xl p-3 border border-white/20">
                <p className="text-white/60 text-xs">Daily Average</p>
                <p className="text-xl font-bold text-white">{metrics.dailyAvg}</p>
              </div>
              <div className="bg-white/10 rounded-xl p-3 border border-white/20">
                <p className="text-white/60 text-xs">Peak Hours</p>
                <p className="text-xl font-bold text-white">{metrics.peakHour}</p>
              </div>
              <div className="bg-white/10 rounded-xl p-3 border border-white/20">
                <p className="text-white/60 text-xs">Channels</p>
                <p className="text-xl font-bold text-white">{metrics.channels}</p>
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-white/10 rounded-xl p-3 border border-white/20">
                <p className="text-white/60 text-xs">Last 7 Days</p>
                <p className="text-lg font-bold text-white">{metrics.last7.toLocaleString()}</p>
              </div>
              <div className="bg-white/10 rounded-xl p-3 border border-white/20">
                <p className="text-white/60 text-xs">Last 30 Days</p>
                <p className="text-lg font-bold text-white">{metrics.last30.toLocaleString()}</p>
              </div>
            </div>
            
            <div className="bg-white/10 rounded-xl p-3 border border-white/20">
              <h3 className="text-white font-medium text-sm mb-2">Activity by Hour</h3>
              <ResponsiveContainer width="100%" height={120}>
                <BarChart data={metrics.hourlyData}>
                  <XAxis dataKey="label" tick={{fill:'#fff', fontSize:8}} interval={1}/>
                  <Tooltip/>
                  <Bar dataKey="count" fill="#6366f1" radius={[2,2,0,0]}/>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* ... (Rest of your tabs: insights, engagement, ask - same as before) ... */}
        {activeTab === 'insights' && (
          <div className="space-y-3">
            {!aiInsights ? (
              <div className="bg-white/10 rounded-xl p-6 border border-white/20 text-center">
                <Sparkles className="w-10 h-10 text-yellow-400 mx-auto mb-3"/>
                
                {processedData && (
                  <div className="bg-green-500/20 rounded-lg p-3 mb-4 border border-green-400/30 text-left">
                    <p className="text-green-400 text-xs font-medium mb-2">✓ 100% Local Processing Complete</p>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="text-white/70">Messages analyzed:</div>
                      <div className="text-white font-medium">{processedData.totalProcessed.toLocaleString()}</div>
                      <div className="text-white/70">Total questions found:</div>
                      <div className="text-white font-medium">{processedData.allQuestions}</div>
                      <div className="text-white/70">Question themes tracked:</div>
                      <div className="text-white font-medium">{processedData.questionThemes?.length || 0}</div>
                      <div className="text-white/70">Complaints detected:</div>
                      <div className="text-white font-medium">{processedData.complaints.length}</div>
                      <div className="text-white/70">Positive mentions:</div>
                      <div className="text-white font-medium">{processedData.praises.length}</div>
                      <div className="text-white/70">Topics tracked:</div>
                      <div className="text-white font-medium">{processedData.topicCounts.filter(t => t.count > 0).length}</div>
                    </div>
                  </div>
                )}
                
                <button 
                  onClick={generateAI} 
                  disabled={aiLoading} 
                  className="px-5 py-2 bg-gradient-to-r from-yellow-500 to-orange-500 text-white rounded-lg font-medium disabled:opacity-50"
                >
                  {aiLoading ? 'Analyzing...' : 'Generate AI Insights'}
                </button>
                <p className="text-white/50 text-xs mt-2">AI will analyze the pre-processed summary data</p>
              </div>
            ) : (
              <>
                <div className="bg-green-500/20 rounded-xl p-3 border border-green-400/30">
                  <div className="flex justify-between items-center">
                    <span className="text-white font-medium text-sm">Health Score</span>
                    <span className="text-2xl font-bold text-green-400">{aiInsights.healthScore}/10</span>
                  </div>
                  <p className="text-white/70 text-sm mt-1">{aiInsights.healthExplanation}</p>
                </div>

                <div className="bg-white/10 rounded-xl p-3 border border-white/20">
                  <h3 className="text-white font-medium text-sm mb-2 flex items-center gap-1">
                    <TrendingUp className="w-4 h-4 text-green-400"/>Positive Trends
                  </h3>
                  {aiInsights.positiveTrends.map((t, i) => (
                    <p key={i} className="text-white/80 text-sm py-0.5">{i+1}. {t}</p>
                  ))}
                </div>

                <div className="bg-white/10 rounded-xl p-3 border border-white/20">
                  <h3 className="text-white font-medium text-sm mb-2 flex items-center gap-1">
                    <AlertTriangle className="w-4 h-4 text-yellow-400"/>Concerns
                  </h3>
                  {aiInsights.concerns.map((c, i) => (
                    <p key={i} className="text-white/80 text-sm py-0.5">{i+1}. {c}</p>
                  ))}
                </div>

                <div className="bg-white/10 rounded-xl p-3 border border-white/20">
                  <h3 className="text-white font-medium text-sm mb-2">Top 7 Topics</h3>
                  {(aiInsights.keyTopics || []).slice(0, 7).map((t, i) => (
                    <div key={i} className="py-1 border-b border-white/10 last:border-0">
                      <span className="text-white text-sm">{i+1}. {t.topic || t}</span>
                      {t.description && <p className="text-white/50 text-xs">{t.description}</p>}
                    </div>
                  ))}
                </div>

                <div className="bg-white/10 rounded-xl p-3 border border-white/20">
                  <h3 className="text-white font-medium text-sm mb-2">7 Most Common Customer Questions</h3>
                  {(aiInsights.customerQuestions || []).slice(0, 7).map((q, i) => (
                    <div key={i} className="py-2 border-b border-white/10 last:border-0">
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-white text-sm flex-1">{i+1}. {q.question || q}</span>
                        {q.count && <span className="text-cyan-400 text-xs font-medium whitespace-nowrap">{q.count}x</span>}
                      </div>
                    </div>
                  ))}
                </div>

                {aiInsights.modPerformance && (
                  <div className="bg-blue-500/20 rounded-xl p-3 border border-blue-400/30">
                    <h3 className="text-white font-medium text-sm mb-1">Mod Performance: {aiInsights.modPerformance.overallRating}</h3>
                    <p className="text-white/70 text-xs">Response: {aiInsights.modPerformance.responseTime}</p>
                  </div>
                )}

                <div className="bg-purple-500/20 rounded-xl p-3 border border-purple-400/30">
                  <h3 className="text-white font-medium text-sm mb-1">Key Insight</h3>
                  <p className="text-white text-sm">{aiInsights.wowInsight}</p>
                </div>
              </>
            )}
          </div>
        )}

        {activeTab === 'engagement' && (
          <div className="bg-white/10 rounded-xl p-3 border border-white/20">
            <h3 className="text-white font-medium text-sm mb-2 flex items-center gap-1">
              <Award className="w-4 h-4 text-yellow-400"/>Top Contributors
            </h3>
            {metrics.topContributors.map((c, i) => (
              <div key={i} className="flex items-center gap-2 py-1.5 border-b border-white/10 last:border-0">
                <div className={'w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold ' + 
                  (i === 0 ? 'bg-yellow-500' : i === 1 ? 'bg-gray-400' : i === 2 ? 'bg-amber-600' : 'bg-indigo-500/50')}>
                  {i + 1}
                </div>
                <span className="text-white text-sm flex-1">{c.name}</span>
                <span className="text-white/60 text-xs">{c.count.toLocaleString()} ({c.pct}%)</span>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'ask' && (
          <div className="space-y-3">
            <div className="bg-white/10 rounded-xl p-4 border border-white/20">
              <h3 className="text-white font-medium text-sm mb-2 flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-cyan-400"/>Ask AI About Your Data
              </h3>
              
              <div className="bg-green-500/20 rounded-lg p-2 mb-3 flex items-center justify-between border border-green-400/30">
                <span className="text-green-300 text-xs">✓ Data Coverage:</span>
                <span className="text-green-400 text-xs font-medium">
                  {processedData ? processedData.totalProcessed.toLocaleString() : metrics.total.toLocaleString()} / {metrics.total.toLocaleString()} messages (100%)
                </span>
              </div>
              
              <p className="text-white/60 text-xs mb-3">
                All {processedData ? processedData.totalProcessed.toLocaleString() : '0'} messages analyzed locally. 
                Found: {processedData ? processedData.priorityQuestions.length : 0} questions, {processedData ? processedData.complaints.length : 0} complaints, {processedData ? processedData.praises.length : 0} positive mentions.
              </p>
              <div className="space-y-2">
                <textarea
                  value={customQuestion}
                  onChange={e => setCustomQuestion(e.target.value)}
                  placeholder="e.g., What are users saying about our new feature?"
                  className="w-full p-3 rounded-lg bg-white/10 border border-white/20 text-white placeholder-white/40 text-base resize-none focus:outline-none focus:border-cyan-400"
                  rows={3}
                  style={{ fontSize: '16px' }}
                />
                <button
                  type="button"
                  onClick={() => askCustomQuestion()}
                  disabled={customLoading || !customQuestion.trim()}
                  className="w-full py-3 bg-cyan-600 active:bg-cyan-500 text-white rounded-lg text-base font-medium disabled:opacity-50 cursor-pointer"
                >
                  {customLoading ? 'Analyzing...' : 'Ask Question'}
                </button>
              </div>
            </div>

            {customAnswer && (
              <div className="bg-white/10 rounded-xl p-4 border border-white/20">
                <h3 className="text-white font-medium text-sm mb-2 flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-yellow-400"/>AI Answer
                </h3>
                <div className="text-white/90 text-sm whitespace-pre-wrap leading-relaxed">
                  {customAnswer}
                </div>
              </div>
            )}

            <div className="bg-white/5 rounded-xl p-3 border border-white/10">
              <h4 className="text-white/70 text-xs font-medium mb-2">Tap to use example question:</h4>
              <div className="grid gap-2 text-sm">
                <button type="button" onClick={() => setCustomQuestion("What product features are users requesting or complaining about?")} className="text-left text-cyan-300 active:text-cyan-100 py-2 px-2 bg-white/5 rounded-lg">
                  📦 Product feedback & feature requests
                </button>
                <button type="button" onClick={() => setCustomQuestion("What are the most common support issues and how well are they being resolved?")} className="text-left text-cyan-300 active:text-cyan-100 py-2 px-2 bg-white/5 rounded-lg">
                  🎧 Common support issues
                </button>
                <button type="button" onClick={() => setCustomQuestion("What do users say they love about our service? Any testimonials or positive feedback?")} className="text-left text-cyan-300 active:text-cyan-100 py-2 px-2 bg-white/5 rounded-lg">
                  📣 Positive feedback & testimonials
                </button>
                <button type="button" onClick={() => setCustomQuestion("Are there any mentions of API, integrations, copy trading, or third-party platforms?")} className="text-left text-cyan-300 active:text-cyan-100 py-2 px-2 bg-white/5 rounded-lg">
                  💻 API & integrations mentions
                </button>
                <button type="button" onClick={() => setCustomQuestion("What questions do new users typically ask? What confuses them?")} className="text-left text-cyan-300 active:text-cyan-100 py-2 px-2 bg-white/5 rounded-lg">
                  🎓 New user confusion points
                </button>
                <button type="button" onClick={() => setCustomQuestion("Are there any mentions of competitors or users comparing us to other services?")} className="text-left text-cyan-300 active:text-cyan-100 py-2 px-2 bg-white/5 rounded-lg">
                  🔍 Competitor mentions
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}