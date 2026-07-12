type IntegrationsPageProps = { baseUrl: string | null; authEnabled: boolean };

export function IntegrationsPage({ baseUrl, authEnabled }: IntegrationsPageProps) {
  return <section className="integrations-page" aria-labelledby="integrations-heading">
    <header className="page-header"><div><h2 id="integrations-heading">集成</h2><p>将本机开发工具连接到已发现的 AMKR 服务。</p></div></header>
    <div className="integration-list">{[["Claude Code", "使用 AMKR 的 OpenAI 兼容地址和本地鉴权。"], ["Codex", "使用 AMKR 的 OpenAI 兼容地址和本地鉴权。"]].map(([name, description]) => <article className="integration-item" key={name}><div><h3>{name}</h3><p>{description}</p></div><span className={baseUrl ? "status-good" : "status-muted"}>{baseUrl ? "服务已就绪" : "等待服务"}</span></article>)}</div>
    {baseUrl ? <p className="integration-note">目标地址 {baseUrl}。{authEnabled ? "本地鉴权已启用。" : "本地鉴权未启用。"}</p> : null}
  </section>;
}
