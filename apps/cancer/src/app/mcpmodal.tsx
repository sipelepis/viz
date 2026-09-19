// "MCP server" dialog: what the endpoint is, how to connect a client to it, and a live tool runner.
import { useEffect, useRef, useState } from 'react';
import { callTool, listTools, type ToolInfo } from './mcp';
import type { Validity } from './validity';

function Copy({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="viewer-btn" aria-label={`Copy ${label}`}
            onClick={() => void navigator.clipboard.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1600); })}>
      <span aria-live="polite">{done ? 'Copied ✓' : 'Copy'}</span>
    </button>
  );
}

const Snippet = ({ label, code }: { label: string; code: string }) => (
  <div className="snippet">
    <div className="snippet-head"><span className="caption">{label}</span><Copy text={code} label={label} /></div>
    <pre tabIndex={0}><code>{code}</code></pre>
  </div>
);

export function McpModal({ validity }: { validity: Validity | null }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [tools, setTools] = useState<ToolInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState<{ name: string; ms?: number; output?: string } | null>(null);
  const url = `${location.origin}/mcp`;

  const open = () => {
    dialog.current?.showModal();
    if (!tools) listTools().then(setTools, (e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };
  const runTool = async (name: string) => {
    setRun({ name });
    const t0 = performance.now();
    try {
      const out = name === 'about_the_data' ? '(the data README, as Markdown)' : JSON.stringify(await callTool<unknown>(name), null, 2);
      setRun({ name, ms: Math.round(performance.now() - t0), output: out.length > 1400 ? `${out.slice(0, 1400)}\n… (${out.length.toLocaleString()} characters in all)` : out });
    } catch (e) {
      setRun({ name, output: `Error: ${e instanceof Error ? e.message : String(e)}` });
    }
  };
  // Light-dismiss: a click on the backdrop closes the dialog.
  useEffect(() => {
    const d = dialog.current;
    const onClick = (e: MouseEvent) => { if (e.target === d) d?.close(); };
    d?.addEventListener('click', onClick);
    return () => d?.removeEventListener('click', onClick);
  }, []);

  return (
    <>
      <button type="button" className="viewer-btn mcp-open" onClick={open} aria-haspopup="dialog">
        <span className="mcp-dot" aria-hidden="true" /> MCP server
      </button>
      <dialog ref={dialog} className="mcp-dialog" aria-labelledby="mcp-title">
        <div className="mcp-head">
          <div>
            <h2 id="mcp-title" className="card-heading">MCP server</h2>
            <p className="caption">
              Everything on this page is read through a Model Context Protocol server. Point your own AI client at
              it to ask questions of the same verified data.
            </p>
          </div>
          <form method="dialog"><button className="viewer-btn" aria-label="Close">Close</button></form>
        </div>

        <p className="mcp-status">
          <span aria-hidden="true">{validity?.verified ? '✓' : '⚠'}</span>{' '}
          {validity?.verified
            ? `Data verified: ${validity.report?.checks.length} ground-truth checks passed.`
            : validity ? `Data not verified. ${validity.reason}` : 'Checking the data…'}
          {' '}Read-only · Streamable HTTP · stateless
        </p>

        <h3 className="validity-subhead">Connect</h3>
        <Snippet label="Endpoint" code={url} />
        <Snippet label="Claude Code" code={`claude mcp add --transport http viz-cancer ${url}`} />
        <Snippet label="Any MCP client (JSON config)" code={JSON.stringify({ mcpServers: { 'viz-cancer': { type: 'http', url } } }, null, 2)} />

        <h3 className="validity-subhead">Tools{tools && ` (${tools.length})`}</h3>
        {error && <p className="caption" role="alert">Couldn’t reach the server: {error}</p>}
        {!tools && !error && <p className="caption">Asking the server for its tools…</p>}
        <ul className="mcp-tools">
          {tools?.map((t) => (
            <li key={t.name}>
              <div className="mcp-tool-head">
                <code className="mention">{t.name}</code>
                <button type="button" className="viewer-btn" aria-label={`Run ${t.name} with its defaults`}
                        disabled={run?.name === t.name && run.output === undefined} onClick={() => void runTool(t.name)}>
                  {run?.name === t.name && run.output === undefined ? 'Running…' : 'Run'}
                </button>
              </div>
              <p className="caption">{t.title}. {t.description}</p>
              {run?.name === t.name && run.output !== undefined && (
                <div className="snippet" aria-live="polite">
                  <div className="snippet-head"><span className="caption">Result with default arguments{run.ms !== undefined && ` · ${run.ms} ms`}</span></div>
                  <pre tabIndex={0}><code>{run.output}</code></pre>
                </div>
              )}
            </li>
          ))}
        </ul>
      </dialog>
    </>
  );
}
