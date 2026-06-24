/**
 * Embeds the Tavus CVI conversation in an iframe.
 * Tavus handles WebRTC audio, lip-sync avatar, and renders the full call UI.
 */
interface TavusAvatarProps {
  conversationUrl: string;
}

export function TavusAvatar({ conversationUrl }: TavusAvatarProps) {
  return (
    <div className="relative w-full h-[540px] rounded-2xl overflow-hidden bg-gray-900 shadow-2xl">
      <iframe
        src={conversationUrl}
        allow="camera; microphone; autoplay; display-capture; fullscreen"
        className="w-full h-full border-0"
        title="Mykare AI Receptionist"
      />
      {/* Mykare branding overlay */}
      <div className="absolute top-3 left-3 flex items-center gap-2 bg-black/50 backdrop-blur-sm rounded-full px-3 py-1">
        <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
        <span className="text-white text-xs font-medium">Mykare Health</span>
      </div>
    </div>
  );
}
