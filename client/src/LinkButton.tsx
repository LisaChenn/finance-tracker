import { useCallback, useEffect, useState } from "react";
import { usePlaidLink } from "react-plaid-link";

interface LinkButtonProps {
  institutionName: string;
  onLinked: () => void;
}

export default function LinkButton({ institutionName, onLinked }: LinkButtonProps) {
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

  return (
    <button className="link-button" onClick={fetchLinkToken} disabled={loading}>
      {loading ? "Loading..." : `Link ${institutionName}`}
    </button>
  );
}
