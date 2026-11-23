import "./bullets.css";
export function Bullets({ items }: { items: string[] }) {
  return <ul className="fl-bullets">{items.map((t, i) => <li key={i}>{t}</li>)}</ul>;
}
