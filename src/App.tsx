const navigation = ["概览", "供应商", "模型路由", "活动", "集成", "设置"];

export default function App() {
  return (
    <main className="app-shell">
      <aside aria-label="主导航" className="sidebar">
        <h1>Keyloom</h1>
        <nav>
          {navigation.map((label) => (
            <button key={label} type="button">
              {label}
            </button>
          ))}
        </nav>
        <p className="service-state">服务未连接</p>
      </aside>
      <section className="content" aria-live="polite">
        <h2>概览</h2>
        <p>正在查找本机 AMKR 服务。</p>
      </section>
    </main>
  );
}

