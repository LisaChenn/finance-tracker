import { useCallback, useEffect, useState } from "react";
import { usePlaidLink } from "react-plaid-link";

type Variant = "chip" | "solid" | "default";

interface LinkButtonProps {
  institutionName: string;
  isLinked: boolean;
  onLinked: () => void;
  variant?: Variant;
  labelWhenUnlinked?: string;
  labelWhenLinked?: string;
}

const CHIP_BASE =
  "font-semibold text-[11.5px] leading-none px-3 py-[7px] rounded-full transition-colors disabled:opacity-60 disabled:cursor-default";
const CHIP_SOFT = `${CHIP_BASE} bg-accent-soft text-accent-text hover:bg-[rgba(77,141,255,0.28)]`;
const CHIP_SOLID = `${CHIP_BASE} bg-accent text-[#08080a] hover:bg-[#6ea3ff]`;
const PILL =
  "font-medium text-[11.5px] leading-none px-[13px] py-2 rounded-full bg-white/5 text-ink/70 hover:bg-white/10 transition-colors disabled:opacity-50 disabled:cursor-default";

export default function LinkButton({
  institutionName,
  isLinked,
  onLinked,
  variant = "default",
  labelWhenUnlinked,
  labelWhenLinked,
}: LinkButtonProps) {
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchLinkToken = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/create_link_token", { method: "POST" });
      const data = await res.json();
      setLinkToken(data.link_token);
    } catch (err) {
      console.error("Failed to create link token", err);
    } finally {
      setLoading(false);
    }
  }, []);

  const onSuccess = useCallback(
    async (public_token: string) => {
      try {
        await fetch("/api/exchange_public_token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ public_token, institution_name: institutionName }),
        });
        onLinked();
      } catch (err) {
        console.error("Failed to exchange public token", err);
      } finally {
        setLinkToken(null);
      }
    },
    [institutionName, onLinked]
  );

  const { open, ready } = usePlaidLink({
    token: linkToken ?? "",
    onSuccess,
  });

  useEffect(() => {
    if (linkToken && ready) {
      open();
    }
  }, [linkToken, ready, open]);

  const label = loading
    ? "…"
    : isLinked
      ? (labelWhenLinked ?? `✓ ${institutionName}`)
      : (labelWhenUnlinked ?? `Link ${institutionName}`);

  const className =
    variant === "chip" ? CHIP_SOFT : variant === "solid" ? CHIP_SOLID : PILL;

  return (
    <button
      className={className}
      onClick={fetchLinkToken}
      disabled={loading}
      title={isLinked ? `Click to re-link ${institutionName}` : undefined}
    >
      {label}
    </button>
  );
}
