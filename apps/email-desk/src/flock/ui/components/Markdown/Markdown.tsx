import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import "./markdown.css";
import { safeHref } from "../../format";
export function Markdown({ text }: { text: string }) {
  return (
    <div className="fl-md">
      <ReactMarkdown skipHtml remarkPlugins={[remarkGfm]} urlTransform={(u) => safeHref(u) ?? ""}
        components={{ table: ({ children }) => <div className="fl-md-table"><table>{children}</table></div>,
          a: ({ href, children }) => href ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span> }}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
