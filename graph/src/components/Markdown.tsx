import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Renders a memory body. `[[memory-id]]` becomes a clickable link (aimem:// scheme). */
export function Markdown({ body, onNavigate }: { body: string; onNavigate?: (id: string) => void }) {
  const src = body.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, id: string, label?: string) => {
    const clean = id.trim();
    return `[${label || clean}](aimem://${encodeURIComponent(clean)})`;
  });
  return (
    <div className="prose-mem">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={(u) => u}
        components={{
          a: ({ href, children }) => {
            if (href?.startsWith("aimem://")) {
              const id = decodeURIComponent(href.slice(8));
              return (
                <button
                  className="rounded bg-accent px-1 font-mono text-[12px] text-foreground hover:underline"
                  onClick={() => onNavigate?.(id)}
                >
                  {children}
                </button>
              );
            }
            return (
              <a href={href} target="_blank" rel="noreferrer">
                {children}
              </a>
            );
          },
        }}
      >
        {src}
      </ReactMarkdown>
    </div>
  );
}
