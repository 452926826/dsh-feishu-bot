window.__ModuleLoader__.load({
  id: "dsh-feishu-bot",
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    const React = require("react")
    const NS = "settings.feishu"

    const css = `
      .dsh-feishu-panel{width:100%;max-width:760px;display:flex;flex-direction:column;gap:16px;color:var(--dsw-alias-label-primary)}
      .dsh-feishu-header{display:flex;align-items:center;justify-content:space-between;gap:12px}
      .dsh-feishu-header h3{margin:0;font-size:16px;line-height:24px}
      .dsh-feishu-muted{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px}
      .dsh-feishu-box{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:8px;padding:16px}
      .dsh-feishu-qr{display:block;width:min(100%,320px);height:auto;margin:0 auto;border-radius:4px;background:#fff}
      .dsh-feishu-grid{display:grid;grid-template-columns:140px minmax(0,1fr);gap:10px 16px;font-size:13px;line-height:20px}
      .dsh-feishu-label{color:var(--dsw-alias-label-tertiary)}
      .dsh-feishu-button{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border-radius:6px;padding:6px 12px;font:inherit;cursor:pointer}
      .dsh-feishu-button:hover{background:var(--dsw-alias-bg-layer-3)}
      .dsh-feishu-error{color:var(--dsw-alias-state-error-primary);font-size:13px;line-height:20px}
      @media(max-width:560px){.dsh-feishu-grid{grid-template-columns:1fr;gap:2px}.dsh-feishu-label{margin-top:8px}}
    `
    if (typeof document !== "undefined" && !document.querySelector("style[data-plugin-css=dsh-feishu]")) {
      const style = document.createElement("style")
      style.dataset.pluginCss = "dsh-feishu"
      style.textContent = css
      document.head.appendChild(style)
    }

    let clientContext
    function FeishuSettingsTab() {
      const [state, setState] = React.useState({ kind: "loading" })
      const [reload, setReload] = React.useState(0)
      React.useEffect(() => {
        let live = true
        const load = async () => {
          try {
            const response = await fetch('/api/plugins/feishu-binding/status', { cache: 'no-store' })
            if (!response.ok) throw new Error(`HTTP ${response.status}`)
            const value = await response.json()
            if (!live) return
            setState({ kind: "ready", value })
          } catch (error) {
            if (live) setState({ kind: "error", message: String(error) })
          }
        }
        void load()
        return () => { live = false }
      }, [reload])

      const panel = (...children) => React.createElement("div", { className: "dsh-feishu-panel" }, ...children)
      const box = (...children) => React.createElement("div", { className: "dsh-feishu-box" }, ...children)
      const row = (label, content) => React.createElement(React.Fragment, null,
        React.createElement("span", { className: "dsh-feishu-label" }, label),
        React.createElement("span", null, content),
      )
      const button = (label, onClick) => React.createElement("button", { className: "dsh-feishu-button", onClick }, label)
      if (state.kind === "loading") return panel(React.createElement("div", { className: "dsh-feishu-muted" }, "正在读取飞书绑定状态…"))
      if (state.kind === "error") return panel(
        React.createElement("div", { className: "dsh-feishu-error" }, "读取飞书绑定状态失败：", state.message),
        button("重试", () => setReload(value => value + 1)),
      )
      const value = state.value
      const header = React.createElement("div", { className: "dsh-feishu-header" },
        React.createElement("h3", null, "飞书配置"),
        button("刷新", () => setReload(value => value + 1)),
      )
      if (value.state === "waiting") return panel(header, box(
        React.createElement("img", { className: "dsh-feishu-qr", src: value.qrDataUrl, alt: "飞书绑定二维码" }),
        React.createElement("p", { className: "dsh-feishu-muted" }, "请使用飞书扫描二维码并完成创建确认。确认后点击刷新。"),
        React.createElement("div", { className: "dsh-feishu-grid" },
          row("连接状态", value.websocket),
          row("二维码更新时间", new Date(value.qrUpdatedAt).toLocaleString()),
        ),
      ))
      if (value.state === "unavailable") return panel(header, box(
        React.createElement("div", { className: "dsh-feishu-muted" }, "尚未绑定飞书机器人。请重启 Harness 生成二维码。"),
      ))
      return panel(header, box(React.createElement("div", { className: "dsh-feishu-grid" },
        row("绑定状态", "已绑定"),
        row("应用 ID", value.appIdMasked),
        value.tenantBrand ? row("租户", value.tenantBrand) : null,
        value.ownerOpenIdMasked ? row("绑定用户", value.ownerOpenIdMasked) : null,
        row("绑定时间", value.boundAt === "environment" ? "环境变量配置" : new Date(value.boundAt).toLocaleString()),
        row("连接状态", value.websocket),
      )))
    }

    const t = key => key === "tab" ? "飞书配置" : key
    const inject = ["locale", "slots"]
    function apply(ctx) {
      clientContext = ctx
      ctx.effect(() => ctx.locale.register(NS, { zh: { tab: "飞书配置" }, en: { tab: "Feishu" } }))
      ctx.slots.inject("settings.plugins.tab", () => ctx.slots.register({ name: "settings.plugins.tab", id: "feishu", order: 40, label: () => t("tab"), locale: NS }, FeishuSettingsTab))
    }
    module.exports = { inject, apply }
    return module.exports
  },
})
