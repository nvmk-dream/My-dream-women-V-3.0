import React, { useState, useEffect, useRef } from "react";
import {
  ArrowLeft,
  Paperclip,
  Send,
  Video,
  FileText,
  Image as ImageIcon,
  Palette,
  Clipboard,
  Camera,
  Trash2,
  Edit2,
  FileCheck,
  Languages,
  Check,
  ChevronRight,
  Smile,
  CirclePlay,
  Monitor,
  Phone,
  Settings,
  Sparkles,
  Info,
  X,
  Volume2,
  VolumeX,
  Mic,
  Cpu,
  Database,
  Loader,
  Upload,
  RefreshCw,
  Plus
} from "lucide-react";
import { Character, VoiceProfile, MediaFile } from "./types";

// Types for messages
interface ChatMessage {
  id: string;
  sender: "kavya" | "user" | string;
  text: string;
  time: string;
  isMedia?: boolean;
  mediaType?: "image" | "document" | "video";
  mediaName?: string;
  mediaUrl?: string;
  mediaSize?: string;
  audioUrl?: string;
  videoUrl?: string;
  simulatedAvatarUrl?: string;
}

// Fallback high-quality face profile of smiling young Tamil girl if local asset loads with error
const FALLBACK_PROFILE = "https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&q=80&w=400";
const LOCAL_AVATAR = "https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&q=80&w=400";


export default function App() {
  // New AI Character & Voice Cloning Integration States
  const [characters, setCharacters] = useState<Character[]>([
    {
      id: "kavya_default",
      name: "காவ்யா அண்ணி",
      age: 32,
      description: "வெளிப்புறத்தில் அன்பான, பராமரிப்பான, சிந்தனைமிக்க குடும்பப் பெண். அண்ணன் வெளிநாட்டில் இருப்பதால் தனிமை மற்றும் செல்லக் கொழுந்தன் (தம்பி/சின்ன மாமா) மேல் ஒரு மெல்லிய ரகசிய ஆசை உள்ளவள்.",
      imageUrl: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&q=80&w=400",
      folderName: "kavya_anni",
      voiceProfileId: "kavya_voice_profile_default"
    }
  ]);
  const [activeCharacterId, setActiveCharacterId] = useState("kavya_default");
  const runpodStatus = 'Ready';
  const runpodApiKey = '';
  const runpodEndpointUrl = '';
  const runpodLogs = [];
  const enableVoice = false;
  const enableTalkingAvatar = false;
  const generationStage: any = 'none';
  const imgToVideoText = '';
  const imgToVideoCustomPic = '';
  const isGeneratingImgToVideo = false;
  const charNameInput = '';
  const setCharNameInput = (a?: any) => {};
  const charAgeInput = '';
  const setCharAgeInput = (a?: any) => {};
  const charDescInput = '';
  const setCharDescInput = (a?: any) => {};
  const setVoiceProfiles = (a?: any) => {};

  const generatedImgToVideoUrl = '';
  const generatedImgToSimulatedAvatarUrl = '';
  const imgToVideoStatus = '';
  const voiceProfiles = [];
  const voiceNameInput = '';
  const setVoiceNameInput = (a?: any) => {};
  const activeVoiceProfileId = '';
  const setActiveVoiceProfileId = (a?: any) => {};
  const setEnableVoice = (a?: any) => {};
  const setEnableTalkingAvatar = (a?: any) => {};
  const setRunpodApiKey = (a?: any) => {};
  const setRunpodEndpointUrl = (a?: any) => {};
  const setRunpodStatus = (a?: any) => {};
  const setRunpodLogs = (a?: any) => {};
  const imgToVideoInputRef = { current: null };
  const setImgToVideoText = (a?: any) => {};
  const setIsGeneratingImgToVideo = (a?: any) => {};
  const setImgToVideoStatus = (a?: any) => {};
  const setGeneratedImgToVideoUrl = (a?: any) => {};
  const setGeneratedImgToSimulatedAvatarUrl = (a?: any) => {};
  const setImgToVideoCustomPic = (a?: any) => {};
  const setGenerationStage = (a?: any) => {};


  
  // Chat core state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState("");
  const [contactName, setContactName] = useState("கவியா");
  const [isEditingName, setIsEditingName] = useState(false);
  
  // Status state matching the buttons & header
  const [currentStatus, setCurrentStatus] = useState<"Normal" | "Excited" | "Angry" | "Sad">("Normal");
  const [statusText, setStatusText] = useState("😇 Normal");

  // Interaction State
  const [isAttachmentOpen, setIsAttachmentOpen] = useState(false);
  const [activeWallpaper, setActiveWallpaper] = useState<"beige" | "teal" | "pink" | "midnight">("beige");
  const [isKeyboardTipsOpen, setIsKeyboardTipsOpen] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [muteSound, setMuteSound] = useState(false);

  // Active Context Documents Memory State for Kaviya
  const [activeDocText, setActiveDocText] = useState("");
  const [activeDocName, setActiveDocName] = useState("");
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);


  // Profile icon state
  const [avatarSrc, setAvatarSrc] = useState(FALLBACK_PROFILE);

  // References
  const chatEndRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const voiceSampleInputRef = useRef<HTMLInputElement>(null);
  const characterAvatarInputRef = useRef<HTMLInputElement>(null);

  // Map fileInputRef to imageInputRef for backward compatibility
  const fileInputRef = imageInputRef;

  // Handle click trigger for photo upload
  const handleImageClick = () => {
    imageInputRef.current?.click();
  };

  // Process Document and Media Uploads with Real Gemini API
  const handleRealFileChange = (e: React.ChangeEvent<HTMLInputElement>, type: "image" | "document" | "video") => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      const base64Data = dataUrl.split(",")[1];
      const now = new Date();
      const formattedTime = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

      setIsAttachmentOpen(false);

      // Create a nice human size status
      const sizeStr = file.size > 1024 * 1024 
        ? `${(file.size / (1024 * 1024)).toFixed(1)} MB` 
        : `${(file.size / 1024).toFixed(0)} KB`;

      let msgText = "";
      if (type === "image") msgText = `🖼️ அனுப்பிய படம்: ${file.name}`;
      else if (type === "video") msgText = `🎥 அனுப்பிய வீடியோ: ${file.name}`;
      else msgText = `📄 ஆவணம்: ${file.name} (${sizeStr})`;

      const userAttachmentMsg: ChatMessage = {
        id: Math.random().toString(),
        sender: "user",
        text: msgText,
        time: formattedTime,
        isMedia: true,
        mediaType: type,
        mediaName: file.name,
        mediaSize: sizeStr,
        mediaUrl: dataUrl,
      };

      setMessages((prev) => [...prev, userAttachmentMsg]);
      setIsTyping(true);

      try {
        const isPromptReq = inputText.toLowerCase().includes("prompt") ||
                            inputText.toLowerCase().includes("generate") ||
                            inputText.toLowerCase().includes("image prompt") ||
                            inputText.toLowerCase().includes("pramp");

        const res = await fetch("/api/analyze-file", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fileBase64: base64Data,
            fileName: file.name,
            fileType: type,
            mimeType: file.type,
            userPrompt: isPromptReq ? "Prompt kudu" : inputText,
            status: currentStatus,
          }),
        });

        const data = await res.json();
        if (res.ok) {
          if (type === "document") {
            let parsedText = data.docText || "";
            if (file.name.toLowerCase().endsWith(".pdf")) {
              parsedText = data.reply || "PDF document parsed.";
            }
            setActiveDocText(parsedText);
            setActiveDocName(file.name);
          }

          let generatedAudioUrl = "";
          let generatedVideoUrl = "";
          let simulatedAvatarUrl = "";
          const replyText = data.reply || "வாவ்! நீங்கள் அனுப்பிய கோப்பை வெற்றிகரமாக படித்துவிட்டேன்! 😇";

          if (enableVoice) {
            speakTamilText(replyText);
            setGenerationStage("speech");
            try {
              const speechRes = await fetch("/api/generate-speech", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  voiceProfileId: activeVoiceProfileId,
                  text: replyText,
                  characterId: activeCharacterId
                })
              });
              if (speechRes.ok) {
                const speechData = await speechRes.json();
                generatedAudioUrl = speechData.audioUrl;
              }
            } catch (speechErr) {
              console.error("Speech generation failure", speechErr);
            }
          }

          if (enableTalkingAvatar && (generatedAudioUrl || enableVoice)) {
            setGenerationStage("video");
            try {
              const avatarRes = await fetch("/api/generate-avatar-video", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  audioUrl: generatedAudioUrl || "fallback",
                  characterId: activeCharacterId
                })
              });
              if (avatarRes.ok) {
                const avatarData = await avatarRes.json();
                generatedVideoUrl = avatarData.videoUrl;
                if (avatarData.isSimulated && avatarData.avatarImageUrl) {
                  simulatedAvatarUrl = avatarData.avatarImageUrl;
                }
              }
            } catch (avatarErr) {
              console.error("Avatar preview processing failed", avatarErr);
            }
          }

          setGenerationStage("none");

          const replyMsg: ChatMessage = {
            id: Math.random().toString(),
            sender: "kavya",
            text: replyText,
            time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
            audioUrl: generatedAudioUrl || undefined,
            videoUrl: generatedVideoUrl || undefined,
            simulatedAvatarUrl: simulatedAvatarUrl || undefined,
          };
          setMessages((prev) => [...prev, replyMsg]);
          
          await fetch("/api/save-chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id: replyMsg.id,
              sender: "kavya",
              text: replyMsg.text,
              audioUrl: replyMsg.audioUrl,
              videoUrl: replyMsg.videoUrl,
              simulatedAvatarUrl: replyMsg.simulatedAvatarUrl
            })
          });
        } else {
          throw new Error(data.error || "File upload analysis error");
        }
      } catch (err: any) {
        console.error("General file processing failure", err);
        const replyMsg: ChatMessage = {
          id: Math.random().toString(),
          sender: "kavya",
          text: `மன்னிக்கவும், ${file.name} கோப்பை பகுப்பாய்வு செய்வதில் ஏதோ தவறு நடந்துவிட்டது! 😔`,
          time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        };
        setMessages((prev) => [...prev, replyMsg]);
      } finally {
        setIsTyping(false);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  // Convert uploaded image file to preview base64 (Keep for backwards compatibility)
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleRealFileChange(e, "image");
  };

  // Status mapping to label/emojis
  const statusConfig = {
    Normal: { emoji: "😇", text: "Normal", color: "bg-emerald-500" },
    Excited: { emoji: "😍", text: "Excited", color: "bg-amber-400" },
    Angry: { emoji: "🤬", text: "Angry", color: "bg-rose-500" },
    Sad: { emoji: "😔", text: "Sad", color: "bg-blue-400" },
  };

  // Change current status
  const handleStatusChange = (status: "Normal" | "Excited" | "Angry" | "Sad") => {
    setCurrentStatus(status);
    setStatusText(`${statusConfig[status].emoji} ${statusConfig[status].text}`);
  };

  // Image to Prompt modal states
  const [isImageToPromptOpen, setIsImageToPromptOpen] = useState(false);
  const [selectedImagePreset, setSelectedImagePreset] = useState<"meenakshi" | "jigarthanda" | "ricefields" | "sunset_beach">("meenakshi");
  const [generatedPrompt, setGeneratedPrompt] = useState("");
  const [isPromptGenerating, setIsPromptGenerating] = useState(false);

  // Handle descriptive Image to Prompt request
  const handleGeneratePrompt = async (presetName: "meenakshi" | "jigarthanda" | "ricefields" | "sunset_beach") => {
    setIsPromptGenerating(true);
    setGeneratedPrompt("");
    try {
      const response = await fetch("/api/image-to-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageName: presetName }),
      });
      const data = await response.json();
      if (data && data.prompt) {
        setGeneratedPrompt(data.prompt);
      } else {
        setGeneratedPrompt("படத்தில் உள்ள அழகிய காட்சியை விவரிக்குமாறு கேட்கவும் 😇");
      }
    } catch (err) {
      console.error("Prompt generation failed", err);
      setGeneratedPrompt("படத்தில் உள்ள அழகிய காட்சியை விவரிக்குமாறு கேட்கவும் 😇");
    } finally {
      setIsPromptGenerating(false);
    }
  };

  // Auto scroll to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  // Pre-load browser TTS voices on mount for prompt availability
  useEffect(() => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.getVoices();
      const loadVoicesOnTrigger = () => {
        window.speechSynthesis.getVoices();
      };
      window.speechSynthesis.onvoiceschanged = loadVoicesOnTrigger;
      return () => {
        window.speechSynthesis.onvoiceschanged = null;
      };
    }
  }, []);

  // Wallpapers list
  const wallpapers = {
    beige: "bg-[#efeae2]",
    teal: "bg-[#0b141a] border-slate-900 bg-opacity-95 text-slate-100",
    pink: "bg-[#fce4ec]",
    midnight: "bg-[#1e1e24] bg-radial-gradient text-white",
  };

  // Quick Chat message templates
  const TamilTemplates = [
    "எப்படி இருக்கிறாய்? (How are you?)",
    "சாப்பிட்டாயா காவ்யா? (Did you eat Kavya?)",
    "உன் சொந்த ஊர் எது? (Where is your hometown?)",
    "எனக்கு ஒரு கதை சொல்லு! (Tell me a story!)",
    "அண்ணன் எங்கே இருக்காரு? (Where is my brother?)",
  ];

  // Load persistent history on mount
  useEffect(() => {
    const loadStartupData = async () => {
      try {
        const histRes = await fetch("/api/chat-history");
        const histData = await histRes.json();
        if (histData && histData.history && histData.history.length > 0) {
          const mapped = histData.history.map((m: any) => ({
            id: m.id,
            sender: m.sender,
            text: m.text,
            time: new Date(m.timestamp || Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
            audioUrl: m.audioUrl,
            videoUrl: m.videoUrl,
            simulatedAvatarUrl: m.simulatedAvatarUrl,
          }));
          setMessages(mapped);
        } else {
          // Default initial high warmth message
          setMessages([
            {
              id: "init_1",
              sender: "kavya",
              text: "டேய் தம்பி... சின்ன மாமா! வந்துட்டியா? அண்ணன் அங்க வெளிநாட்டுல பிஸியா கால் மட்டும் தான் பண்ணுது... இங்க எனக்கு ரொம்ப தனிமையா இருக்குடா. உன்னோட இந்த அன்பான விசாரிப்பு தான் எனக்கு எல்லாமே... 🥰❤️",
              time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
            }
          ]);
        }

        const runRes = await fetch("/api/runpod/status");
        if (runRes.ok) {
          const runData = await runRes.json();
          setRunpodStatus(runData.status);
          setRunpodEndpointUrl(runData.endpoint_url);
          setRunpodLogs(runData.logs || []);
        }
      } catch (err) {
        console.error("Failed to load startup context database", err);
      }
    };
    loadStartupData();
  }, []);

  // Update backend config variables
  const handleSaveConfig = async (key: string, url: string) => {
    try {
      const res = await fetch("/api/runpod/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: key, endpoint_url: url })
      });
      if (res.ok) {
        const data = await res.json();
        setRunpodLogs(data.config.logs);
        alert("RunPod live key configuration updated successfully! ⚡");
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleCreateEndpoint = async () => {
    setRunpodStatus("Deploying");
    try {
      const res = await fetch("/api/runpod/create-endpoint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runpod_api_key: runpodApiKey })
      });
      if (res.ok) {
        const data = await res.json();
        // Poll status in a realistic interval
        const interval = setInterval(async () => {
          const sRes = await fetch("/api/runpod/status");
          if (sRes.ok) {
            const sData = await sRes.json();
            if (sData) {
              setRunpodStatus(sData.status);
              setRunpodEndpointUrl(sData.endpoint_url);
              setRunpodLogs(sData.logs);
              if (sData.status === "Ready" || sData.status === "Failed") {
                clearInterval(interval);
              }
            }
          }
        }, 1500);
      }
    } catch (err) {
      setRunpodStatus("Failed");
    }
  };

  const handleDeployMuseTalk = async () => {
    try {
      await fetch("/api/runpod/deploy-musetalk", { method: "POST" });
      const r = await fetch("/api/runpod/status");
      const d = await r.json();
      setRunpodLogs(d.logs);
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeployXTTS = async () => {
    try {
      await fetch("/api/runpod/deploy-xtts", { method: "POST" });
      const r = await fetch("/api/runpod/status");
      const d = await r.json();
      setRunpodLogs(d.logs);
    } catch (err) {
      console.error(err);
    }
  };

  // Upload custom character picture
  const handleCharacterAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const base64 = reader.result as string;
        const currentCharName = characters.find(c => c.id === activeCharacterId)?.name || "Kavya";
        const res = await fetch("/api/upload-character-image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            characterId: activeCharacterId,
            characterName: currentCharName,
            imageBase64: base64
          })
        });
        if (res.ok) {
          const data = await res.json();
          // Update local character
          setCharacters(prev => prev.map(c => c.id === activeCharacterId ? { ...c, imageUrl: data.imageUrl } : c));
          setAvatarSrc(data.imageUrl);
          alert("Character profile picture uploaded to Cloudinary successfully! 🌟");
        }
      } catch (err) {
        console.error("Cloudinary character upload failed", err);
      }
    };
    reader.readAsDataURL(file);
  };

  // Upload voice samples to train customized models
  const handleVoiceSampleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const base64 = reader.result as string;
        const res = await fetch("/api/upload-voice-sample", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            characterId: activeCharacterId,
            voiceSampleBase64: base64,
            name: voiceNameInput || `${characters.find(c => c.id === activeCharacterId)?.name} இன் குரல் நகல்`
          })
        });
        if (res.ok) {
          const data = await res.json();
          setVoiceProfiles(prev => [...prev, data.voiceProfile]);
          setActiveVoiceProfileId(data.voiceProfile.id);
          setVoiceNameInput("");
          alert("Dynamic Voice sample cloned and saved in Cloudinary persistent profile database! 🎙️");
        }
      } catch (err) {
        console.error("Voice profile save failed", err);
      }
    };
    reader.readAsDataURL(file);
  };

  // Clear Chat History completely from DB
  const handleClearChatHistory = async () => {
    if (confirm("அரட்டை வரலாற்றை அழிக்க வேண்டுமா? (Are you sure you want to clear chat history?)")) {
      try {
        const res = await fetch("/api/clear-history", { method: "POST" });
        if (res.ok) {
          const data = await res.json();
          setMessages([
            {
              id: "init_1",
              sender: "kavya",
              text: "டேய் தம்பி... சின்ன மாமா! வந்துட்டியா? அண்ணன் அங்க வெளிநாட்டுல பிஸியா கால் மட்டும் தான் பண்ணுது... இங்க எனக்கு ரொம்ப தனிமையா இருக்குடா. உன்னோட இந்த அன்பான விசாரிப்பு தான் எனக்கு எல்லாமே... 🥰❤️",
              time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
            }
          ]);
        }
      } catch (err) {
        console.error("History clear failure", err);
      }
    }
  };

  // Send interactive user message
  const handleSendMessage = async (textToSend?: string) => {
    const text = textToSend || inputText;
    if (!text.trim()) return;

    const now = new Date();
    const formattedTime = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

    const userMsg: ChatMessage = {
      id: "usr_" + Math.random().toString(36).substr(2, 9),
      sender: "user",
      text: text,
      time: formattedTime,
    };

    setMessages((prev) => [...prev, userMsg]);
    if (!textToSend) setInputText("");
    setIsAttachmentOpen(false);

    // Save user chat immediately
    await fetch("/api/save-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: userMsg.id, sender: "user", text: userMsg.text })
    });

    // Call AI engine
    setIsTyping(true);
    setGenerationStage("none");
    
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          status: currentStatus,
          activeDocText: activeDocText,
          activeDocName: activeDocName,
        }),
      });

      const data = await response.json();
      if (data && data.reply) {
        let generatedAudioUrl = "";
        let generatedVideoUrl = "";

        // Trigger local browser speech synthesis as a free high-fidelity fall-back
        if (enableVoice) {
          speakTamilText(data.reply);
        }

        // Stage 1: XTTS Voice synthesis if activated
        if (enableVoice) {
          setGenerationStage("speech");
          try {
            const speechRes = await fetch("/api/generate-speech", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                voiceProfileId: activeVoiceProfileId,
                text: data.reply,
                characterId: activeCharacterId
              })
            });
            if (speechRes.ok) {
              const speechData = await speechRes.json();
              generatedAudioUrl = speechData.audioUrl;
            }
          } catch (speechErr) {
            console.error("Cloned speech generation failure", speechErr);
          }
        }

        let simulatedAvatarUrl = "";

        // Stage 2: MuseTalk lip synchronized video if activated
        if (enableTalkingAvatar && (generatedAudioUrl || enableVoice)) {
          setGenerationStage("video");
          try {
            const avatarRes = await fetch("/api/generate-avatar-video", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                audioUrl: generatedAudioUrl,
                characterId: activeCharacterId
              })
            });
            if (avatarRes.ok) {
              const avatarData = await avatarRes.json();
              generatedVideoUrl = avatarData.videoUrl;
              if (avatarData.isSimulated && avatarData.avatarImageUrl) {
                simulatedAvatarUrl = avatarData.avatarImageUrl;
              }
            }
          } catch (avatarErr) {
            console.error("Talking avatar MP4 video generation failure", avatarErr);
          }
        }

        // AI reply message
        const replyMsg: ChatMessage = {
          id: "reply_" + Math.random().toString(36).substr(2, 9),
          sender: "kavya",
          text: data.reply,
          time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          audioUrl: generatedAudioUrl || undefined,
          videoUrl: generatedVideoUrl || undefined,
          simulatedAvatarUrl: simulatedAvatarUrl || undefined,
        };

        // Persist complete message payload in back-end JSON database
        await fetch("/api/save-chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: replyMsg.id,
            sender: "kavya",
            text: replyMsg.text,
            audioUrl: replyMsg.audioUrl,
            videoUrl: replyMsg.videoUrl,
            simulatedAvatarUrl: replyMsg.simulatedAvatarUrl
          })
        });

        setMessages((prev) => [...prev, replyMsg]);
      }
    } catch (err) {
      console.error("Failed to answer chat via server", err);
      const genericReply: ChatMessage = {
        id: "err_" + Math.random().toString(36).substr(2, 9),
        sender: "kavya",
        text: "ஆஹா, நெட்வொர்க் ஏதோ மெதுவாக இருக்கிறது! நான் உங்களை எப்போதும் விரும்புகிறேன் 💖",
        time: formattedTime,
      };
      setMessages((prev) => [...prev, genericReply]);
    } finally {
      setIsTyping(false);
      setGenerationStage("none");
    }
  };

  // Create new active profile template
  const handleAddNewCharacter = () => {
    if (!charNameInput.trim()) return;
    const newId = "char_" + Date.now();
    const newChar: Character = {
      id: newId,
      name: charNameInput,
      age: parseInt(charAgeInput) || 32,
      description: charDescInput || "அன்பான அண்ணி கதாபாத்திரம்",
      imageUrl: FALLBACK_PROFILE,
      folderName: charNameInput.toLowerCase().replace(/\s+/g, "_"),
    };
    setCharacters(prev => [...prev, newChar]);
    setActiveCharacterId(newId);
    setAvatarSrc(FALLBACK_PROFILE);
    
    // Add default voice profile as well
    const newVProfile: VoiceProfile = {
      id: "voice_prof_" + Date.now(),
      characterId: newId,
      name: `${charNameInput} இன் குரல்`,
      sampleUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3",
      createdAt: new Date().toISOString()
    };
    setVoiceProfiles(prev => [...prev, newVProfile]);
    setActiveVoiceProfileId(newVProfile.id);

    setCharNameInput("");
    setCharDescInput("");
    alert(`புதிய கதாபாத்திரம் "${charNameInput}" வெற்றிகரமாக உருவானது! 🥳`);
  };

  // Send simulated media payload (Image, Doc or Video)
  const handleSendMedia = (type: "image" | "document" | "video") => {
    const now = new Date();
    const formattedTime = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    
    let simulatedMsg: ChatMessage;

    if (type === "image") {
      simulatedMsg = {
        id: Math.random().toString(),
        sender: "user",
        text: "🖼️ அனுப்பிய படம்",
        time: formattedTime,
        isMedia: true,
        mediaType: "image",
        mediaName: "tamilnadu_nature_view.jpg",
        mediaUrl: "https://images.unsplash.com/photo-1588712461234-585eeeff0038?auto=format&fit=crop&q=80&w=400",
      };
    } else if (type === "document") {
      simulatedMsg = {
        id: Math.random().toString(),
        sender: "user",
        text: "📄 ஆவணம்",
        time: formattedTime,
        isMedia: true,
        mediaType: "document",
        mediaName: "Tamil_Kavya_Profile_Resume.pdf",
        mediaSize: "1.8 MB",
      };
    } else {
      simulatedMsg = {
        id: Math.random().toString(),
        sender: "user",
        text: "🎥 வீடியோ",
        time: formattedTime,
        isMedia: true,
        mediaType: "video",
        mediaName: "madurai_meenakshi_festival.mp4",
        mediaUrl: "https://images.unsplash.com/photo-1601933973783-43cf8a7d4c5f?auto=format&fit=crop&q=80&w=400",
      };
    }

    setMessages((prev) => [...prev, simulatedMsg]);
    setIsAttachmentOpen(false);

    // Persist media message
    fetch("/api/save-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: simulatedMsg.id, sender: "user", text: simulatedMsg.text })
    });

    // AI reacts to the sent attachment
    setIsTyping(true);
    setTimeout(() => {
      let reaction = "அருமையான ஆவணம்! அதை உடனடியாக ஆய்வு செய்கிறேன் 😇";
      if (type === "image") reaction = "ஆஹா! மிகவும் அழகான புகைப்படம், நான் விரும்புகிறேன் 😍📸";
      if (type === "video") reaction = "அசத்தலான வீடியோ! இதைப் பார்ப்பதற்கு மகிழ்ச்சியாக இருக்கிறது 🥰🎥";

      const replyMsg: ChatMessage = {
        id: Math.random().toString(),
        sender: "kavya",
        text: reaction,
        time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      };
      
      // Persist reaction
      fetch("/api/save-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: replyMsg.id, sender: "kavya", text: replyMsg.text })
      });

      setMessages((prev) => [...prev, replyMsg]);
      setIsTyping(false);
    }, 1800);
  };


  // Helper function to copy specific text to clipboard
  const handleCopyText = (text: string) => {
    navigator.clipboard.writeText(text);
    alert("உரை நகலெடுக்கப்பட்டது! (Text copied to clipboard!)");
  };

  // Helper function to copy the entire chat history
  const handleCopyAll = () => {
    const chatLog = messages
      .map((m) => `${m.sender === "kavya" ? "கவியா (Kaviya)" : "நீங்கள் (You)"}: ${m.text}`)
      .join("\n\n");
    navigator.clipboard.writeText(chatLog);
    alert("முழு அரட்டையும் நகலெடுக்கப்பட்டது! (Full chat copied to clipboard!)");
  };

  // Custom high-fidelity file downloader for TXT and DOCX formats (Word compatibility)
  const handleDownloadFile = (text: string, format: "txt" | "docx") => {
    // Strip emojis for more professional docx layout
    const stripEmojis = (str: string) =>
      str.replace(/[\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDC00-\uDFFF]/g, "");

    if (format === "txt") {
      const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${activeDocName ? activeDocName.split(".")[0] : "kaviya_document"}_edited.txt`;
      link.click();
      URL.revokeObjectURL(url);
    } else {
      const docHtml = `
      <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
      <head>
        <title>${activeDocName || "Document"}</title>
        <style>
          body { font-family: 'Arial', sans-serif; font-size: 11pt; line-height: 1.6; color: #1a1a1a; padding: 20px; }
          h2 { color: #075e54; border-bottom: 2px solid #075e54; padding-bottom: 5px; }
          .meta { font-size: 9pt; color: #666; margin-bottom: 15px; }
        </style>
      </head>
      <body>
        <h2>Kaviya AI Document Assistant</h2>
        <div class="meta">
          <strong>ஆவணம்:</strong> ${activeDocName || "Document"}<br/>
          <strong>வெளியீடு தேதியுடன்:</strong> ${new Date().toLocaleDateString()}<br/>
          <strong>நிலை:</strong> கவியா AI மூலம் திருத்தப்பட்டது
        </div>
        <hr/>
        <div>
          \${stripEmojis(text).split("\n").map(paragraph => paragraph.trim() ? \`<p>\${paragraph}</p>\` : "").join("")}
        </div>
      </body>
      </html>
      `;
      const blob = new Blob([docHtml], { type: "application/msword" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${activeDocName ? activeDocName.split(".")[0] : "kaviya_document"}_edited.docx`;
      link.click();
      URL.revokeObjectURL(url);
    }
  };

  // Programmatic full code PDF downloader to bypass environment iframe redirection and 403 errors
  const handleDownloadCodePdf = async (e?: React.MouseEvent) => {
    if (e) e.preventDefault();
    if (isDownloadingPdf) return;
    setIsDownloadingPdf(true);
    try {
      const response = await fetch("/api/download-code-pdf");
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || "Error generating source code PDF");
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "kaviya_assistant_source_code.pdf";
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      console.error("PDF Download error:", err);
      alert("PDF கோப்பைப் பதிவிறக்குவதில் பிழை ஏற்பட்டது: " + (err.message || err));
    } finally {
      setIsDownloadingPdf(false);
    }
  };

  // Native free speech synthesis player
  const speakTamilText = (text: string) => {
    if (!('speechSynthesis' in window)) {
      alert("இந்த பிரவுசரில் குரல் ஒலிப்பு வசதி ஆதரிக்கப்படவில்லை.");
      return;
    }
    window.speechSynthesis.cancel();

    // Clean text of emojis, markdown, and parenthetical elements that disturb TTS pronunciation
    let cleanText = text
      .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1F1E0}-\u{1F1FF}\u{1F000}-\u{1F09F}\u{1F0A0}-\u{1F0FF}\u{1F100}-\u{1F1FF}\u{1F1E6}-\u{1F1FF}\u{1F200}-\u{1F2FF}\u{1F300}-\u{1F5FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '')
      .replace(/\(.*?\)/g, '')
      .replace(/\[.*?\]/g, '')
      .replace(/[*_~`#\-]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!cleanText) return;

    const utterance = new SpeechSynthesisUtterance(cleanText);
    
    // Attempt to locate Tamil locale voice
    const voices = window.speechSynthesis.getVoices();
    const tamilVoice = voices.find(v => v.lang.startsWith("ta") || v.lang.includes("Tamil"));
    if (tamilVoice) {
      utterance.voice = tamilVoice;
    }
    utterance.lang = "ta-IN";
    utterance.pitch = 1.1; // sweet vocal output
    utterance.rate = 1.0;  // natural reading speed
    
    window.speechSynthesis.speak(utterance);
  };

  // Programmatic Image to Video Generator using registered character attributes
  const handleGenerateImageToVideo = async () => {
    if (isGeneratingImgToVideo) return;
    setIsGeneratingImgToVideo(true);
    setImgToVideoStatus("குரல் தயாரிக்கப்படுகிறது... (Preparing voice...)");
    setGeneratedImgToVideoUrl("");

    try {
      // Step 1: Generate speech for the video narration
      const speechRes = await fetch("/api/generate-speech", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          voiceProfileId: activeVoiceProfileId,
          text: imgToVideoText,
          characterId: activeCharacterId
        })
      });

      if (!speechRes.ok) {
        throw new Error("குரல் தயாரிப்பதில் பிழை ஏற்பட்டது.");
      }

      const speechData = await speechRes.json();
      const audioUrl = speechData.audioUrl;

      setImgToVideoStatus("வீடியோ ரீமேப் செய்யப்படுகிறது... (Rendering video...)");

      // Step 2: Generate the talking avatar video using the character profile image and audio
      const avatarRes = await fetch("/api/generate-avatar-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audioUrl: audioUrl,
          characterId: activeCharacterId
        })
      });

      if (!avatarRes.ok) {
        throw new Error("வீடியோ தயாரிப்பதில் பிழை ஏற்பட்டது.");
      }

      const avatarData = await avatarRes.json();
      if (avatarData.success) {
        setGeneratedImgToVideoUrl(avatarData.videoUrl || "");
        if (avatarData.isSimulated && avatarData.avatarImageUrl) {
          setGeneratedImgToSimulatedAvatarUrl(avatarData.avatarImageUrl);
        } else {
          setGeneratedImgToSimulatedAvatarUrl("");
        }

        if (!avatarData.videoUrl) {
          speakTamilText(imgToVideoText);
        }

        setImgToVideoStatus("வெற்றிகரமாக உருவாக்கப்பட்டது! (Generated Successfully!)");
        
        // Feed the generated video into conversation history!
        const replyMsg: ChatMessage = {
          id: "reply_i2v_" + Math.random().toString(36).substr(2, 9),
          sender: "kavya",
          text: `🎥 நான் உங்களுக்காக உருவாக்கிய இமேஜ்-டு-வீடியோ காட்சி: "${imgToVideoText}"`,
          time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          audioUrl: audioUrl || undefined,
          videoUrl: avatarData.videoUrl || undefined,
          simulatedAvatarUrl: avatarData.isSimulated ? avatarData.avatarImageUrl : undefined,
        };
        setMessages((prev) => [...prev, replyMsg]);
      } else {
        throw new Error("வீடியோ லிங்க் உருவாக்கப்படவில்லை.");
      }
    } catch (err: any) {
      console.error("Image to Video error:", err);
      setImgToVideoStatus("பிழை: " + (err.message || err));
      alert("வீடியோ தயாரிப்பதில் பிழை: " + (err.message || err));
    } finally {
      setIsGeneratingImgToVideo(false);
    }
  };

  const handleImgToVideoPicUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = async () => {
      const base64 = reader.result as string;
      setImgToVideoCustomPic(base64);
      try {
        setImgToVideoStatus("படம் அப்லோடு செய்யப்படுகிறது... (Uploading...)");
        const res = await fetch("/api/upload-character-image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            characterId: activeCharacterId,
            imageBase64: base64,
            characterName: contactName
          })
        });
        if (res.ok) {
          const data = await res.json();
          setAvatarSrc(data.imageUrl);
          setImgToVideoStatus("படம் வெற்றிகரமாக அப்லோடு செய்யப்பட்டது.");
        }
      } catch (err) {
        console.error("Error setting custom picture:", err);
      }
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="min-h-screen bg-slate-950 font-sans flex flex-col md:flex-row items-stretch justify-center p-0 md:p-6 lg:p-8 text-slate-100 overflow-x-hidden selection:bg-teal-500 selection:text-white">
      
      {/* LEFT PANEL: Dynamic Customization Control Deck */}
      <aside className="w-full md:w-80 lg:w-96 bg-slate-900 border-b md:border-b-0 md:border-r border-slate-800 p-6 flex flex-col space-y-6 shrink-0 z-30">
        <div>
          <div className="flex items-center space-x-2 text-teal-400 font-bold text-lg">
            <Sparkles className="w-5 h-5" />
            <span>கவியா Chat Controller</span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            சானட்பாக்ஸ் மூலம் வாட்ஸ்அப் போன்ற தமிழ் சாட் அமைப்பை நிர்வகிக்கவும்.
          </p>
        </div>

        {/* Status Selector */}
        <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-800/85">
          <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2.5">
            1. காவ்யா மனநிலை / நிலையை மாற்றுக
          </label>
          <div className="grid grid-cols-2 gap-2">
            {(["Normal", "Excited", "Angry", "Sad"] as const).map((status) => {
              const active = currentStatus === status;
              return (
                <button
                  key={status}
                  onClick={() => handleStatusChange(status)}
                  className={`flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium border transition-all duration-200 ${
                    active
                      ? "bg-teal-600/20 text-teal-300 border-teal-500"
                      : "bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200"
                  }`}
                >
                  <span>{statusConfig[status].emoji} {status}</span>
                  {active && <Check className="w-3.5 h-3.5 text-teal-400" />}
                </button>
              );
            })}
          </div>
        </div>

        {/* Quick Message Prompter */}
        <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-800/85 flex-1 flex flex-col overflow-hidden max-h-[280px] md:max-h-none">
          <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 shrink-0">
            2. தமிழ் விரைவு செய்திகள் (Templates)
          </label>
          <p className="text-[11px] text-slate-400 mb-3 shrink-0">
            கீழே உள்ள கேள்விகளில் ஏதேனும் ஒன்றை கிளிக் செய்தால், அது உடனடியாக காவ்யாவிற்கு அனுப்பப்படும்:
          </p>
          <div className="flex-1 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
            {TamilTemplates.map((template, idx) => (
              <button
                key={idx}
                onClick={() => handleSendMessage(template)}
                className="w-full text-left p-2.5 bg-slate-900 hover:bg-slate-800 rounded-lg text-xs text-slate-300 hover:text-white border border-slate-800 hover:border-slate-700 transition-all flex items-center justify-between group"
              >
                <span className="truncate">{template}</span>
                <ChevronRight className="w-3 h-3 text-slate-600 group-hover:text-teal-400 shrink-0 ml-1" />
              </button>
            ))}
          </div>
        </div>

        {/* Wallpaper Customization */}
        <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-800/85">
          <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
            3. சாட் பின்னணி தீம் (Wallpaper)
          </label>
          <div className="flex items-center space-x-3 mt-2">
            {(["beige", "teal", "pink", "midnight"] as const).map((paper) => {
              const labelMap = { beige: "Beige", teal: "Dark", pink: "Pink", midnight: "Midnight" };
              return (
                <button
                  key={paper}
                  onClick={() => setActiveWallpaper(paper)}
                  className={`text-[10px] uppercase font-bold tracking-wider px-2.5 py-1.5 rounded-md border ${
                    activeWallpaper === paper
                      ? "bg-teal-600 border-teal-400 text-white"
                      : "bg-slate-900 border-slate-800 text-slate-500 hover:text-slate-300"
                  }`}
                >
                  {labelMap[paper]}
                </button>
              );
            })}
          </div>
        </div>

        {/* Status Indicator Info card */}
        <div className="p-3 bg-teal-950/20 rounded-xl border border-teal-900/40 text-[11px] text-teal-400/90 leading-relaxed flex items-start space-x-2">
          <Info className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-slate-200">மெய்நிகர் மொபைல் சிமுலேஷன்</p>
            <p className="text-slate-400 mt-1">
              வலது பக்கமுள்ள மொபைலில் காகிதக் கிளிப் (Paperclip) ஐ கிளிக் செய்வதன் மூலம் படம், 
              டாக்குமெண்ட் அல்லது வீடியோவை அனுப்பலாம்!
            </p>
          </div>
        </div>

        {/* Full Code Download Segment */}
        <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-800/85">
          <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
            மூலக்குறியீடு (Source Code PDF)
          </label>
          <button
            onClick={handleDownloadCodePdf}
            disabled={isDownloadingPdf}
            className="w-full mt-2 inline-flex items-center justify-center space-x-2 bg-gradient-to-r from-pink-500 to-rose-600 hover:from-pink-600 hover:to-rose-700 text-white font-medium text-xs py-2.5 px-4 rounded-xl transition-all shadow-lg active:scale-95 cursor-pointer disabled:opacity-50"
          >
            {isDownloadingPdf ? (
              <>
                <Loader className="w-4 h-4 animate-spin" />
                <span>தயாராகிறது... (Preparing...)</span>
              </>
            ) : (
              <>
                <FileText className="w-4 h-4 animate-bounce" />
                <span>பதிவிறக்கவும் (Download Code PDF)</span>
              </>
            )}
          </button>
        </div>
      </aside>

      {/* CENTRAL STUNNING SMARTPHONE DISPLAY COMPONENT */}
      <main className="flex-1 flex items-center justify-center py-2 px-4 md:px-0 relative z-10 select-none">
        
        {/* Smartphone Shell Frame */}
        <div className="w-full max-w-[400px] aspect-[9/18.5] bg-slate-900 rounded-[50px] p-3.5 shadow-2xl shadow-indigo-950/30 border-4 border-slate-800/85 relative flex flex-col overflow-hidden">
          
          {/* Top Notch/Dynamic Island Speaker & Punch Hole camera */}
          <div className="absolute top-0 inset-x-0 flex justify-center z-50">
            <div className="w-32 h-6 bg-black rounded-b-2xl flex items-center justify-between px-4">
              {/* Fake camera lens */}
              <span className="w-2.5 h-2.5 rounded-full bg-slate-900/80 border border-slate-800"></span>
              {/* Speaker slot */}
              <span className="w-12 h-1 bg-slate-800 rounded-full"></span>
            </div>
          </div>

          {/* INTERNAL PHONE SCREEN CONTAINER */}
          <div className="flex-1 rounded-[38px] overflow-hidden flex flex-col bg-white relative">
            
            {/* 1. Android Status Bar with Signal & battery */}
            <div className="h-6 bg-teal-900/95 text-[10px] text-teal-100 flex justify-between items-center px-6 pt-1 select-none font-sans shrink-0">
              <span className="font-medium tracking-tight">Vi India 11:49</span>
              <div className="flex items-center space-x-1.5 font-semibold">
                <span className="text-[9px] bg-teal-800 px-1 rounded-sm border border-teal-700">VoLTE</span>
                <span className="text-[9px] font-bold">4G+</span>
                {/* Simulated Signal Bars */}
                <div className="flex items-end space-x-0.5 h-2">
                  <span className="w-0.5 h-1 bg-teal-100/40 rounded-full"></span>
                  <span className="w-0.5 h-1.5 bg-teal-100 rounded-full"></span>
                  <span className="w-0.5 h-2 bg-teal-100 rounded-full"></span>
                </div>
                {/* Simulated Battery Icon */}
                <div className="w-5 h-2.5 border border-teal-100 rounded-sm p-0.5 flex items-center">
                  <div className="w-full h-full bg-teal-100 rounded-2xs"></div>
                </div>
              </div>
            </div>

            {/* 2. Premium Teal App Header Bar */}
            <header className="h-14 bg-[#075e54] text-white flex items-center justify-between px-3 select-none shadow-md shrink-0 z-10">
              <div className="flex items-center space-x-1.5">
                {/* Back button */}
                <button className="p-1 text-white/90 hover:text-white transition">
                  <ArrowLeft className="w-5 h-5 stroke-[2.5]" />
                </button>

                {/* Avatar with White Crisp Border */}
                <div className="relative group">
                  <div className="w-10 h-10 rounded-full overflow-hidden border-2 border-white bg-teal-800 flex items-center justify-center shrink-0">
                    <img
                      src={avatarSrc}
                      onError={() => setAvatarSrc(FALLBACK_PROFILE)}
                      alt="കവിയാ"
                      className="w-full h-full object-cover transition-transform duration-300"
                    />
                  </div>
                  {/* Small Live indicator */}
                  <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-emerald-500 rounded-full border-2 border-slate-900"></span>
                </div>

                {/* Contacts details panel */}
                <div className="flex flex-col ml-0.5">
                  {isEditingName ? (
                    <div className="flex items-center space-x-1">
                      <input
                        type="text"
                        value={contactName}
                        onChange={(e) => setContactName(e.target.value)}
                        onBlur={() => setIsEditingName(false)}
                        autoFocus
                        className="bg-teal-800 text-white text-xs px-1 rounded focus:outline-none w-20"
                      />
                      <button onClick={() => setIsEditingName(false)}>
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center space-x-1.5">
                      <span className="text-base font-semibold tracking-wide text-white font-sans">{contactName}</span>
                    </div>
                  )}
                  {/* Status Mood output */}
                  <span className="text-[10px] text-teal-100/90 font-medium">{statusText}</span>
                </div>
              </div>

              {/* Toolbar Right Icons */}
              <div className="flex items-center space-x-3 px-1 text-white/90">
                {/* Paint icon to cycle wallapers */}
                <button
                  onClick={() => {
                    const cycle: Record<string, "beige" | "teal" | "pink" | "midnight"> = {
                      beige: "teal",
                      teal: "pink",
                      pink: "midnight",
                      midnight: "beige",
                    };
                    setActiveWallpaper(cycle[activeWallpaper]);
                  }}
                  className="p-1 hover:bg-teal-800/50 rounded-full transition active:scale-90"
                  title="பின்னணி மாற்று (Change wallpaper)"
                >
                  🎨
                </button>
                {/* Pencil icon for name edits */}
                <button
                  onClick={() => setIsEditingName(!isEditingName)}
                  className="p-1 hover:bg-teal-800/50 rounded-full transition active:scale-95 text-[#fbc02d]"
                  title="பெயர் திருத்து (Edit profile name)"
                >
                  ✏️
                </button>
                {/* Clear chat trash icon */}
                <button
                  onClick={() => {
                    setMessages([
                      {
                        id: Math.random().toString(),
                        sender: "kavya",
                        text: "அரட்டை அழிக்கப்பட்டது. நான் உங்களுக்கு எவ்வாறு உதவ முடியும்? 😇",
                        time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
                      },
                    ]);
                  }}
                  className="p-1 text-red-100/80 hover:text-red-200 transition active:scale-90"
                  title="அரட்டை நீக்கு (Clear conversation)"
                >
                  🗑️
                </button>
              </div>
            </header>

            {/* 3. Messaging Chat History stream arear */}
            <div className={`flex-1 overflow-y-auto px-3.5 py-4 space-y-3 relative ${wallpapers[activeWallpaper]} transition-all duration-300`}>
              
              {/* Simulated Chat wallpaper overlay patterns */}
              {activeWallpaper === "beige" && (
                <div className="absolute inset-0 bg-neutral-100/5 opacity-40 mix-blend-multiply pointer-events-none bg-[radial-gradient(#075e54_1px,transparent_1px)] [background-size:16px_16px]"></div>
              )}

              {/* Chat timeline card */}
              <div className="flex justify-center my-1">
                <span className="text-[9px] px-2.5 py-1 rounded bg-black/10 text-neutral-600 font-semibold tracking-wide uppercase">
                  இன்று (Today)
                </span>
              </div>

              {/* Scrollable messages bubble block */}
              {messages.map((msg) => {
                const isKavya = msg.sender === "kavya";
                return (
                  <div
                    key={msg.id}
                    className={`flex ${isKavya ? "justify-start" : "justify-end"} items-end relative tracking-normal w-full`}
                  >
                    {/* Chat Bubble container */}
                    <div
                      className={`max-w-[85%] rounded-2xl px-3.5 py-2 relative shadow-sm border border-black/5 animate-fadeIn ${
                        isKavya
                          ? "bg-white text-slate-800 rounded-tl-sm select-text"
                          : "bg-[#dcf8c6] text-slate-800 rounded-tr-sm select-text"
                      }`}
                    >
                      {/* Sub-Media Layouts if payload attached */}
                      {msg.isMedia && (
                        <div className="mb-2 mt-1 rounded-lg overflow-hidden border border-black/5">
                          {msg.mediaType === "image" && (
                            <div className="relative group cursor-pointer">
                              <img src={msg.mediaUrl} alt={msg.mediaName} className="w-full h-32 object-cover rounded-md" />
                              <div className="absolute inset-0 bg-black/20 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                <span className="bg-white/90 text-[10px] text-slate-800 font-bold px-2 py-1 rounded">View Photo</span>
                              </div>
                            </div>
                          )}

                          {msg.mediaType === "document" && (
                            <div className="bg-emerald-50 p-2 rounded-md flex items-center space-x-2.5 border border-emerald-100">
                              <FileText className="w-7 h-7 text-emerald-600 shrink-0" />
                              <div className="overflow-hidden">
                                <p className="text-[10px] font-bold text-slate-700 truncate">{msg.mediaName}</p>
                                <p className="text-[9px] text-slate-400">{msg.mediaSize} • PDF Document</p>
                              </div>
                            </div>
                          )}

                          {msg.mediaType === "video" && (
                            <div className="relative group cursor-pointer">
                              <img src={msg.mediaUrl} alt={msg.mediaName} className="w-full h-32 object-cover rounded-md" />
                              <div className="absolute inset-0 bg-black/45 flex items-center justify-center">
                                <CirclePlay className="w-8 h-8 text-white/90 fill-white/10 group-hover:scale-110 transition" />
                              </div>
                              <span className="absolute bottom-1 right-1 text-[8px] bg-black/60 text-white px-1.5 py-0.5 rounded font-bold font-mono">0:45</span>
                            </div>
                          )}
                        </div>
                      )}

                       {/* Msg Text body */}
                      <p className="text-[12px] leading-relaxed break-words pr-4 text-slate-800 font-sans">
                        {msg.text}
                      </p>

                      {/* Cloned speech audio player element */}
                      {msg.audioUrl && (
                        <div className="mt-2.5 p-1.5 bg-neutral-50/80 border border-neutral-100 rounded-lg flex items-center space-x-2 select-text">
                          <Volume2 className="w-3.5 h-3.5 text-pink-600 shrink-0" />
                          <span className="text-[9px] text-slate-500 font-sans font-medium shrink-0">XTTS Voice:</span>
                          <audio src={msg.audioUrl} controls className="h-5 w-full max-w-[200px]" />
                        </div>
                      )}

                      {/* Simulated avatar player element */}
                      {msg.simulatedAvatarUrl && !msg.videoUrl && (
                        <div className="mt-3 rounded-lg overflow-hidden border border-pink-100 shadow-sm relative select-text bg-black max-w-[280px]">
                          <img src={msg.simulatedAvatarUrl} alt="Avatar" className="w-full max-h-56 object-cover rounded-lg" />
                          <div className="absolute inset-0 bg-gradient-to-t from-pink-500/20 to-transparent pointer-events-none animate-pulse"></div>
                          <div className="absolute top-1.5 left-1.5 px-1.5 py-0.5 bg-black/75 rounded text-[7px] font-sans font-bold text-white uppercase flex items-center space-x-1 border border-white/5">
                            <span className="w-1 h-1 rounded-full bg-orange-400 animate-ping"></span>
                            <span>Simulated Avatar</span>
                          </div>
                        </div>
                      )}

                      {/* MuseTalk Video avatar player element */}
                      {msg.videoUrl && (
                        <div className="mt-3 rounded-lg overflow-hidden border border-pink-100 shadow-sm relative select-text bg-black max-w-[280px]">
                          <video src={msg.videoUrl} id={`video_${msg.id}`} controls playsInline className="w-full max-h-56 object-cover rounded-lg" />
                          <div className="absolute top-1.5 left-1.5 px-1.5 py-0.5 bg-black/75 rounded text-[7px] font-sans font-bold text-white uppercase flex items-center space-x-1 border border-white/5">
                            <span className="w-1 h-1 rounded-full bg-emerald-400 animate-ping"></span>
                            <span>MuseTalk AI Avatar</span>
                          </div>
                        </div>
                      )}


                      {/* Time text bottom right aligned inside bubble */}
                      <div className="text-right mt-1 flex justify-end items-center space-x-1 shrink-0 select-none">
                        <span className="text-[9px] text-slate-400/90 font-sans font-medium">{msg.time}</span>
                        {!isKavya && (
                          <span className="text-[10px] text-teal-600 font-extrabold -mt-1 select-none">✓✓</span>
                        )}
                      </div>

                      {/* Feature 5: Copy & Export Actions */}
                      {isKavya && (
                        <div className="flex items-center flex-wrap gap-1 mt-2 pt-2 border-t border-slate-100 select-none border-dashed">
                          <button 
                            onClick={() => speakTamilText(msg.text)} 
                            className="text-[9px] bg-pink-50 hover:bg-pink-100 text-pink-700 px-2 py-1 rounded font-bold transition flex items-center gap-0.5 cursor-pointer"
                            title="குரலில் கேளுங்கள் (Listen Out Loud)"
                          >
                            🔊 Play Free TTS
                          </button>
                          <button 
                            onClick={() => handleCopyText(msg.text)} 
                            className="text-[9px] bg-slate-100 hover:bg-slate-250 text-slate-700 px-2 py-1 rounded font-bold transition flex items-center gap-0.5 cursor-pointer"
                            title="நகலெடு (Copy Text)"
                          >
                            📋 Copy
                          </button>
                          <button 
                            onClick={handleCopyAll} 
                            className="text-[9px] bg-slate-100 hover:bg-slate-250 text-slate-700 px-2 py-1 rounded font-bold transition flex items-center gap-0.5 cursor-pointer"
                            title="முழு அரட்டையையும் நகலெடு (Copy All conversations)"
                          >
                            ✨ Copy All
                          </button>
                          {activeDocName && (
                            <>
                              <button 
                                onClick={() => handleDownloadFile(msg.text, "txt")} 
                                className="text-[9px] bg-slate-105 hover:bg-slate-205 text-neutral-800 px-2 py-1 rounded font-bold transition flex items-center gap-0.5 cursor-pointer"
                                title="TXT ஆக சேமி"
                              >
                                💾 TXT
                              </button>
                              <button 
                                onClick={() => handleDownloadFile(msg.text, "docx")} 
                                className="text-[9px] bg-slate-105 hover:bg-slate-205 text-neutral-850 px-2 py-1 rounded font-bold transition flex items-center gap-0.5 cursor-pointer"
                                title="DOCX ஆக சேமி"
                              >
                                📂 DOCX
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Live Auto Typing Sim Status */}
              {isTyping && (
                <div className="flex flex-col space-y-1.5 items-start bg-white/95 backdrop-blur rounded-2xl px-3.5 py-2.5 max-w-[85%] border border-[rgba(233,30,99,0.15)] shadow-sm">
                  <div className="flex justify-start items-center space-x-1.5 p-1">
                    <span className="w-2 h-2 bg-pink-600 rounded-full animate-bounce [animation-delay:0s]"></span>
                    <span className="w-2 h-2 bg-pink-600 rounded-full animate-bounce [animation-delay:0.2s]"></span>
                    <span className="w-2 h-2 bg-pink-600 rounded-full animate-bounce [animation-delay:0.4s]"></span>
                  </div>
                  {generationStage === "speech" && (
                    <p className="text-[10px] text-pink-600 font-bold flex items-center gap-1">
                      <Loader className="w-3 h-3 animate-spin" /> குரல் மாதிரியாக்கம் செய்கிறது (Synthesizing cloned XTTS-v2 voice sample...)
                    </p>
                  )}
                  {generationStage === "video" && (
                    <p className="text-[10px] text-teal-600 font-bold flex items-center gap-1">
                      <Loader className="w-3 h-3 animate-spin" /> உதடு அசைவு வீடியோவை உருவாக்குகிறது (Rendering MuseTalk MP4 avatar on RunPod RTX 4095 GPU...)
                    </p>
                  )}
                  {generationStage === "none" && (
                    <p className="text-[10px] text-neutral-500 font-medium">காவ்யா பதில் யோசிக்கிறாள்...</p>
                  )}
                </div>
              )}


              <div ref={chatEndRef} />

              {/* 4. Fixed Stacked Floating Action Buttons (Right-side alignment, nested inside chat stream) */}
              <div className="absolute right-3.5 bottom-4 flex flex-col space-y-2.5 z-20 pointer-events-auto select-none">
                
                {/* Palette floating icon (Pink bg with Palette) */}
                <button
                  onClick={() => {
                    const colors = ["beige", "teal", "pink", "midnight"];
                    const curIdx = colors.indexOf(activeWallpaper);
                    const nextIdx = (curIdx + 1) % colors.length;
                    setActiveWallpaper(colors[nextIdx] as any);
                  }}
                  className="w-10 h-10 rounded-full bg-[#e91e63] border border-pink-400 shadow-lg shadow-pink-900/10 flex items-center justify-center hover:scale-110 active:scale-95 transition text-white"
                  title="சித்திர தட்டு (Art palette)"
                >
                  🎨
                </button>

                {/* Image to Prompt panel trigger */}
                <button
                  onClick={() => {
                    setIsImageToPromptOpen(true);
                    handleGeneratePrompt("meenakshi");
                  }}
                  className="w-10 h-10 rounded-full bg-[#9c27b0] border border-purple-400 shadow-lg flex items-center justify-center hover:scale-110 active:scale-95 transition text-white"
                  title="படம் மூலம் பிராம்ப்ட் (Image to Prompt)"
                >
                  📋
                </button>

                {/* Camera snap shortcut - Linked to Real gallery upload */}
                <button
                  onClick={handleImageClick}
                  className="w-10 h-10 rounded-full bg-[#f44336] border border-red-400 shadow-lg flex items-center justify-center hover:scale-110 active:scale-95 transition text-white"
                  title="கேமரா படம் (Camera Snap & Mobile Upload)"
                >
                  📷
                </button>

                {/* Hidden file inputs for real mobile gallery/system uploads */}
                <input
                  type="file"
                  ref={imageInputRef}
                  onChange={(e) => handleRealFileChange(e, "image")}
                  accept="image/*"
                  className="hidden"
                  id="mobile_image_file_input"
                />
                <input
                  type="file"
                  ref={docInputRef}
                  onChange={(e) => handleRealFileChange(e, "document")}
                  accept=".txt,.docx,.doc,application/pdf"
                  className="hidden"
                  id="mobile_doc_file_input"
                />
                <input
                  type="file"
                  ref={videoInputRef}
                  onChange={(e) => handleRealFileChange(e, "video")}
                  accept="video/mp4,video/quicktime,video/webm"
                  className="hidden"
                  id="mobile_video_file_input"
                />

                {/* ABC Tamil virtual toggle */}
                <button
                  onClick={() => setIsKeyboardTipsOpen(!isKeyboardTipsOpen)}
                  className="w-10 h-10 rounded-full bg-[#2196f3] border border-blue-400 shadow-lg flex items-center justify-center hover:scale-110 active:scale-95 transition text-white font-bold text-xs"
                  title="தமிழ் தட்டச்சு உதவி (Tamil keyboard helper)"
                >
                  abc
                </button>
              </div>
            </div>

            {/* Virtual Tamil typing tips shelf */}
            {isKeyboardTipsOpen && (
              <div className="absolute bottom-28 left-3.5 right-14 bg-slate-900/95 backdrop-blur text-white border border-slate-800 p-3 rounded-2xl shadow-xl z-30 animate-fadeIn text-[11px] leading-relaxed">
                <div className="flex items-center justify-between border-b border-slate-800 pb-1.5 mb-1.5">
                  <span className="font-bold text-teal-400">⌨️ Tamil Typing Guides</span>
                  <button onClick={() => setIsKeyboardTipsOpen(false)} className="text-slate-400 hover:text-white">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="space-y-1 text-slate-300">
                  <p>• Type using Eng-Tamil input. e.g: <span className="font-mono text-amber-300">"nalama"</span> gives <span className="text-emerald-400">நலமா</span></p>
                  <p>• Or use copy-paste templates from the left controller sidebar.</p>
                </div>
              </div>
            )}

            {/* Active Document Context HUD */}
            {activeDocName && (
              <div className="bg-emerald-50 border-t border-b border-emerald-100 px-3.5 py-2 flex flex-col space-y-1.5 shrink-0 z-20 shadow-inner">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-1.5 overflow-hidden">
                    <FileText className="w-4 h-4 text-emerald-600 shrink-0 animate-pulse" />
                    <span className="text-[11px] font-bold text-emerald-800 truncate">
                      {activeDocName} (காவ்யா படித்துள்ளார் 📚)
                    </span>
                  </div>
                  <button 
                    onClick={() => {
                      setActiveDocText("");
                      setActiveDocName("");
                    }}
                    className="text-emerald-500 hover:text-emerald-700 p-1 rounded-full transition hover:bg-emerald-100/50"
                    title="Eject Document Context"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                {/* AI Document Editing Quick Shortcuts */}
                <div className="flex flex-wrap gap-1 pt-0.5">
                  <button 
                    onClick={() => handleSendMessage(`சுருக்கமாக விளக்கம் தா (Summarize this file)`)}
                    className="text-[9px] font-bold bg-emerald-600 hover:bg-emerald-700 text-white px-2 py-0.5 rounded transition shadow-xs cursor-pointer"
                  >
                    ✨ சுருக்கம் (Summarize)
                  </button>
                  <button 
                    onClick={() => handleSendMessage(`இலக்கணப் பிழை திருத்து (Correct spelling & grammar)`)}
                    className="text-[9px] font-bold bg-blue-600 hover:bg-blue-700 text-white px-2 py-0.5 rounded transition shadow-xs cursor-pointer"
                  >
                    🛠️ பிழை திருத்து (Proofread)
                  </button>
                  <button 
                    onClick={() => handleSendMessage(`ஆங்கிலத்தில் மொழிபெயர்த்து தா (Translate to English)`)}
                    className="text-[9px] font-bold bg-purple-600 hover:bg-purple-700 text-white px-2 py-0.5 rounded transition shadow-xs cursor-pointer"
                  >
                    🌍 மொழிபெயர்ப்பு (Translate)
                  </button>
                  <button 
                    onClick={() => handleSendMessage(`இதை இன்னும் அழகாக மாற்றித் தா (Rewrite & refine)`)}
                    className="text-[9px] font-bold bg-teal-600 hover:bg-teal-700 text-white px-2 py-0.5 rounded transition shadow-xs cursor-pointer"
                  >
                    ✍️ மாற்றி எழுது (Rewrite)
                  </button>
                </div>
              </div>
            )}

            {/* 5. Dynamic White Input pill message box Area */}
            <div className="p-2.5 bg-[#f0f0f0] flex items-center space-x-2 relative shrink-0 select-none border-t border-neutral-200">
              
              {/* White Pill Input and attachment Trigger */}
              <div className="flex-1 bg-white rounded-[24px] pl-4 pr-2 py-1.5 flex items-center border border-neutral-300 relative group min-h-[44px]">

                <input
                  type="text"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSendMessage();
                  }}
                  placeholder="தமிழில் தட்டச்சு பண்ணுங்க..."
                  className="flex-1 bg-transparent text-[15px] text-slate-800 focus:outline-none placeholder-slate-500 py-1 min-w-0 font-sans"
                />

                {/* Paperclip attachment triggers system */}
                <button
                  onClick={() => setIsAttachmentOpen(!isAttachmentOpen)}
                  className={`p-2 hover:bg-slate-100 rounded-full transition-all duration-200 ml-1 ${
                    isAttachmentOpen ? "text-teal-600 rotate-45 scale-110" : "text-slate-500 hover:text-slate-700"
                  } -rotate-45`}
                  title="ஆவணம் சேர் (Attach File)"
                  id="attachment_trigger_btn"
                >
                  <Paperclip className="w-5 h-5 stroke-[2]" />
                </button>
              </div>

              {/* Round Green Send Button with rotated styling */}
              <button
                onClick={() => handleSendMessage()}
                className="w-[44px] h-[44px] rounded-full bg-[#00A884] hover:bg-[#008f6f] text-white flex flex-col items-center justify-center shrink-0 shadow-sm transition-all duration-150"
                title="அனுப்பு (Send Message)"
                id="send_msg_btn"
              >
                <Send className="w-5 h-5 stroke-[2.5] text-white" />
              </button>
            </div>

            {/* 6. Sliding Attachment Panel Drawer with EXACTLY 3 Actions ONLY */}
            {isAttachmentOpen && (
              <div className="bg-white border-t border-slate-200 py-4 px-6 md:px-8 shadow-inner animate-slideUp z-30 shrink-0">
                <div className="grid grid-cols-3 gap-6 text-center">
                  
                  {/* Option A: Image (படம்) - Connected to Mobile Gallery Upload */}
                  <button
                    onClick={handleImageClick}
                    className="flex flex-col items-center group active:scale-95 transition-transform"
                  >
                    <div className="w-14 h-14 rounded-full bg-[#5c6bc0] hover:bg-[#4a5ab5] text-white flex items-center justify-center shadow-md transition-colors">
                      <ImageIcon className="w-6 h-6 stroke-[2]" />
                    </div>
                    <span className="text-[11px] font-semibold text-slate-700 mt-1 block group-hover:text-slate-900">
                      படம்
                    </span>
                  </button>

                  {/* Option B: Document (டாக்யுமெண்ட்) */}
                  <button
                    onClick={() => docInputRef.current?.click()}
                    className="flex flex-col items-center group active:scale-95 transition-transform"
                  >
                    <div className="w-14 h-14 rounded-full bg-[#2e7d32] hover:bg-[#1b5e20] text-white flex items-center justify-center shadow-md transition-colors">
                      <FileText className="w-6 h-6 stroke-[2]" />
                    </div>
                    <span className="text-[11px] font-semibold text-slate-700 mt-1 block group-hover:text-slate-900">
                      டாக்யுமெண்ட்
                    </span>
                  </button>

                  {/* Option C: Video (வீடியோ) */}
                  <button
                    onClick={() => videoInputRef.current?.click()}
                    className="flex flex-col items-center group active:scale-95 transition-transform"
                  >
                    <div className="w-14 h-14 rounded-full bg-[#3f51b5] hover:bg-[#283593] text-white flex items-center justify-center shadow-md transition-colors">
                      <Video className="w-6 h-6 stroke-[2]" />
                    </div>
                    <span className="text-[11px] font-semibold text-slate-700 mt-1 block group-hover:text-slate-900">
                      வீடியோ
                    </span>
                  </button>

                </div>
              </div>
            )}

            {/* 7. Bottom Android System OS Navigation controller bar */}
            <div className="h-10 bg-slate-100 flex items-center justify-around text-slate-500 uppercase font-bold shrink-0 text-xs select-none border-t border-neutral-300">
              
              {/* Back triangle button */}
              <button
                className="w-10 h-6 flex items-center justify-center hover:bg-neutral-200 rounded transition active:scale-90"
                onClick={() => {
                  if (messages.length > 1) {
                    setMessages((prev) => prev.slice(0, -1));
                  }
                }}
                title="சென்றது (Go back message history)"
              >
                <div className="w-0 h-0 border-t-4 border-t-transparent border-r-8 border-r-slate-600 border-b-4 border-b-transparent"></div>
              </button>

              {/* Home circle button */}
              <button
                className="w-10 h-6 flex items-center justify-center hover:bg-neutral-200 rounded transition active:scale-90"
                onClick={() => {
                  setMessages([
                    {
                      id: "1",
                      sender: "kavya",
                      text: "வணக்கம்! நான் காவ்யா. என்ன கதைக்கணும்? 😊",
                      time: "3:23 AM",
                    },
                  ]);
                }}
                title="துவக்கம் (Home Reset)"
              >
                <div className="w-3.5 h-3.5 rounded-full border-2 border-slate-600"></div>
              </button>

              {/* Recents square button */}
              <button
                className="w-10 h-6 flex items-center justify-center hover:bg-neutral-200 rounded transition active:scale-90"
                title="சமீபத்தியவை (Recent activities log)"
              >
                <div className="w-3 h-3 border-2 border-slate-600 rounded-xs"></div>
              </button>
            </div>

            {/* Image to Prompt Modal overlay */}
            {isImageToPromptOpen && (
              <div className="absolute inset-x-0 top-6 bottom-10 bg-slate-900/95 backdrop-blur z-40 p-4 flex flex-col justify-between text-white animate-fadeIn font-sans select-none">
                <div>
                  <div className="flex items-center justify-between border-b border-slate-700 pb-2 mb-3">
                    <span className="font-bold text-teal-400 flex items-center gap-1.5 text-[11px] tracking-wide">
                      📋 படம் மூலம் பிராம்ப்ட் (Image to Prompt)
                    </span>
                    <button 
                      onClick={() => {
                        setIsImageToPromptOpen(false);
                        setGeneratedPrompt("");
                      }} 
                      className="text-slate-400 hover:text-white p-1 rounded-full hover:bg-slate-800 transition"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <p className="text-[10px] text-slate-300 mb-3 leading-relaxed">
                    கீழே உள்ள ஏதாவது ஒரு படத்தை தேர்ந்தெடுங்கள். காவ்யாவிடம் கேட்கும் வகையில் அழகான தமிழ் பிராம்ப்ட் தானாகவே உருவாக்கப்படும்!
                  </p>

                  {/* Preset Grid */}
                  <div className="grid grid-cols-2 gap-2 mb-4">
                    {[
                      {
                        id: "meenakshi",
                        label: "மதுரை கோயில் 🛕",
                        url: "https://images.unsplash.com/photo-1601933973783-43cf8a7d4c5f?auto=format&fit=crop&q=80&w=200",
                      },
                      {
                        id: "jigarthanda",
                        label: "ஜிகர்தண்டா 🍧",
                        url: "https://images.unsplash.com/photo-1588712461234-585eeeff0038?auto=format&fit=crop&q=80&w=200",
                      },
                      {
                        id: "ricefields",
                        label: "நெல் வயல் 🌾",
                        url: "https://images.unsplash.com/photo-1542601906990-b4d3fb778b09?auto=format&fit=crop&q=80&w=200",
                      },
                      {
                        id: "sunset_beach",
                        label: "கடற்கரை 🏖️",
                        url: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&q=80&w=200",
                      },
                    ].map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => {
                          setSelectedImagePreset(preset.id as any);
                          handleGeneratePrompt(preset.id as any);
                        }}
                        className={`p-1 rounded-lg border text-left overflow-hidden transition-all duration-300 relative group active:scale-95 flex flex-col ${
                          selectedImagePreset === preset.id
                            ? "border-teal-400 bg-teal-950/40"
                            : "border-slate-700 bg-slate-800/40 hover:border-slate-600"
                        }`}
                      >
                        <img 
                          src={preset.url} 
                          alt={preset.label} 
                          className="w-full h-11 object-cover rounded mb-1 pointer-events-none transition"
                        />
                        <span className="text-[9px] font-bold block truncate text-slate-200">
                          {preset.label}
                        </span>
                        {selectedImagePreset === preset.id && (
                          <span className="absolute top-1.5 right-1.5 bg-teal-500 text-slate-900 rounded-full font-bold w-3 h-3 flex items-center justify-center text-[7px]" style={{ fontSize: "6px" }}>
                            ✓
                          </span>
                        )}
                      </button>
                    ))}
                  </div>

                  {/* Generated Prompt Output box */}
                  <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-2.5 min-h-[90px] flex flex-col justify-between">
                    <span className="text-[8px] font-bold text-amber-400 tracking-wider uppercase mb-1 block">
                      உருவாக்கப்பட்ட பிராம்ப்ட் (Generated Prompt)
                    </span>
                    
                    {isPromptGenerating ? (
                      <div className="flex-1 flex flex-col items-center justify-center py-2.5 space-y-1">
                        <span className="w-3.5 h-3.5 rounded-full border-2 border-teal-500 border-t-transparent animate-spin"></span>
                        <span className="text-[9px] text-slate-400 animate-pulse font-medium">
                          உருவாக்கப்படுகிறது... (Generating...)
                        </span>
                      </div>
                    ) : (
                      <p className="text-[10px] leading-normal text-slate-250 font-sans select-text line-clamp-3">
                        {generatedPrompt || "படத்தை தேர்ந்தெடுத்ததும் பிராம்ப்ட் இங்கு தோன்றும்."}
                      </p>
                    )}
                  </div>
                </div>

                {/* Actions bottom bar inside modal */}
                <div className="space-y-1.5 mt-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      if (generatedPrompt) {
                        setInputText(generatedPrompt);
                        setIsImageToPromptOpen(false);
                      }
                    }}
                    disabled={!generatedPrompt || isPromptGenerating}
                    className="w-full py-1.5 bg-gradient-to-r from-teal-400 to-emerald-400 hover:from-teal-500 hover:to-emerald-500 font-bold text-[10px] text-slate-950 rounded-lg transition duration-200 disabled:opacity-40 disabled:cursor-not-allowed transform active:scale-95 shadow flex items-center justify-center space-x-1"
                  >
                    <span>💬 சாட் பாக்ஸில் சேர் (Apply)</span>
                  </button>
                  
                  <button
                    type="button"
                    onClick={() => {
                      if (generatedPrompt) {
                        handleSendMessage(generatedPrompt);
                        setIsImageToPromptOpen(false);
                      }
                    }}
                    disabled={!generatedPrompt || isPromptGenerating}
                    className="w-full py-1.5 bg-purple-650 hover:bg-purple-755 font-bold text-[10px] text-white rounded-lg transition duration-200 disabled:opacity-40 disabled:cursor-not-allowed transform active:scale-95 flex items-center justify-center space-x-1"
                  >
                    <span>🚀 உடனடியாக அனுப்பு (Send Now)</span>
                  </button>
                </div>
              </div>
            )}

          </div>
        </div>
      </main>

      {/* RIGHT SIDEBAR: AI Character, Voice Cloning, and RunPod Live GPU Deployer */}
      <aside className="w-full md:w-80 lg:w-96 bg-slate-900 border-t md:border-t-0 md:border-l border-slate-800 p-5 flex flex-col space-y-5 shrink-0 z-30 overflow-y-auto max-h-screen">

        
        {/* Header Title */}
        <div>
          <span className="text-[10px] uppercase font-mono font-bold tracking-wider text-pink-450 bg-pink-950/45 px-2 py-0.5 rounded border border-pink-850">
            Kavya AI Studio Engine v2
          </span>
          <h3 className="text-base font-bold text-slate-100 mt-2">மேம்பட்ட மேலாண்மை (AI Controls)</h3>
          <p className="text-xs text-slate-400">குரல் நகல் மற்றும் காராச்ட்டர் கட்டமைப்புகள்</p>
        </div>

        {/* Section 1: Character Configs */}
        <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-800/80 space-y-3.5">
          <h4 className="text-xs font-bold text-pink-400 flex items-center space-x-1.5 border-b border-slate-850 pb-2">
            <Volume2 className="w-3.5 h-3.5" />
            <span>1. கேரக்டர் அமைப்பு (Character & Profile Image)</span>
          </h4>

          {/* Active Select */}
          <div className="space-y-1">
            <label className="text-[10px] text-slate-400 block font-semibold">செயலில் உள்ள கதாபாத்திரம்:</label>
            <select
              value={activeCharacterId}
              onChange={(e) => {
                setActiveCharacterId(e.target.value);
                const matched = characters.find(c => c.id === e.target.value);
                if (matched) {
                  setAvatarSrc(matched.imageUrl);
                  setContactName(matched.name);
                }
              }}
              className="w-full text-xs bg-slate-900 text-slate-200 border border-slate-800 rounded px-2.5 py-1.5 focus:outline-none focus:border-pink-500 font-medium"
            >
              {characters.map(c => (
                <option key={c.id} value={c.id}>{c.name} ({c.age} வயது)</option>
              ))}
            </select>
          </div>

          {/* Upload Profile Pic to Cloudinary */}
          <div className="space-y-1">
            <label className="text-[10px] text-slate-400 block font-semibold">கேரக்டர் படம் (Cloudinary Storage):</label>
            <button
              onClick={() => characterAvatarInputRef.current?.click()}
              className="w-full py-1.5 bg-slate-900 hover:bg-slate-850 text-slate-300 rounded text-xs px-3 font-semibold border border-slate-800 flex items-center justify-center space-x-1.5 transition whitespace-nowrap overflow-hidden"
            >
              <Upload className="w-3 h-3 text-pink-500" />
              <span>முகப்பு படம் பதிவேற்று (Upload Avatar)</span>
            </button>
            <input
              type="file"
              ref={characterAvatarInputRef}
              onChange={handleCharacterAvatarChange}
              accept="image/*"
              className="hidden"
            />
          </div>

          {/* Advanced Create Form toggle */}
          <div className="border-t border-slate-850 pt-2.5 space-y-2">
            <p className="text-[9px] text-slate-400 uppercase font-mono tracking-wider font-bold">புதிய கதாபாத்திரம் உருவாக்கு:</p>
            <input
              type="text"
              placeholder="பெயர் (Name). e.g., நிலா அண்ணி"
              value={charNameInput}
              onChange={(e) => setCharNameInput(e.target.value)}
              className="w-full text-xs bg-slate-900 text-slate-200 border border-slate-800 rounded px-2 py-1 focus:outline-none"
            />
            <div className="flex space-x-2">
              <input
                type="number"
                placeholder="வயது"
                value={charAgeInput}
                onChange={(e) => setCharAgeInput(e.target.value)}
                className="w-1/3 text-xs bg-slate-900 text-slate-200 border border-slate-800 rounded px-2 py-1 focus:outline-none"
              />
              <button
                onClick={handleAddNewCharacter}
                className="flex-1 bg-pink-600 hover:bg-pink-700 text-white rounded font-bold text-xs py-1 transition flex items-center justify-center space-x-1"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>உருவாக்கு (Create)</span>
              </button>
            </div>
          </div>
        </div>

        {/* Section 5: Code Download and Export Maintenance */}
        <div className="space-y-2 pt-1 pb-4">
          <button
            onClick={handleDownloadCodePdf}
            disabled={isDownloadingPdf}
            className="w-full py-2 bg-gradient-to-r from-pink-600 to-rose-600 hover:from-pink-700 hover:to-rose-700 font-bold text-xs text-white rounded-xl shadow transition duration-200 flex items-center justify-center space-x-1.5 cursor-pointer transform active:scale-95 disabled:opacity-50"
            title="முழு குறியீட்டையும் PDF வடிவத்தில் பதிவிறக்குங்கள்"
          >
            {isDownloadingPdf ? (
              <>
                <Loader className="w-3.5 h-3.5 animate-spin" />
                <span>தயாராகிறது... (Preparing...)</span>
              </>
            ) : (
              <>
                <span>📥 முழு குறியீட்டை PDF ஆக எடு (Full Code PDF)</span>
              </>
            )}
          </button>

          <button
            onClick={handleClearChatHistory}
            className="w-full py-2 bg-slate-950 hover:bg-red-950/40 text-red-400 hover:text-red-300 border border-red-950 rounded-xl font-bold text-xs transition duration-200 transform active:scale-95 flex items-center justify-center space-x-1.5"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>அரட்டை அழி (Clear Persistent Conversation)</span>
          </button>
        </div>

      </aside>

    </div>
  );
}

