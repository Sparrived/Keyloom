import { useEffect, useState } from "react";
import {
  deleteAmkrUnifiedModel,
  getAmkrModels,
  getAmkrUnifiedModel,
  updateAmkrUnifiedModel,
  type AmkrModel,
  type AmkrUnifiedModel,
} from "../../api/amkr";

type UnifiedModelPanelProps = {
  configPath: string | null;
  onChange?: (unifiedModel: AmkrUnifiedModel | null) => void;
  refreshToken?: number;
};

type RoutingChoice = "auto" | "key";

const errorMessage = (reason: unknown) => reason instanceof Error ? reason.message : String(reason);

function statusLabel(unifiedModel: AmkrUnifiedModel | null) {
  const target = unifiedModel?.default.primary;
  if (!target) return "未启用";
  return target.key ? `固定 Key · ${target.key}` : "自动路由";
}

export function UnifiedModelPanel({ configPath, onChange, refreshToken = 0 }: UnifiedModelPanelProps) {
  const [models, setModels] = useState<AmkrModel[]>([]);
  const [unifiedModel, setUnifiedModel] = useState<AmkrUnifiedModel | null>(null);
  const [selectedModel, setSelectedModel] = useState("");
  const [routingChoice, setRoutingChoice] = useState<RoutingChoice>("auto");
  const [selectedKey, setSelectedKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const [modelsResponse, unifiedResponse] = await Promise.all([
          getAmkrModels(configPath),
          getAmkrUnifiedModel(configPath),
        ]);
        if (cancelled) return;
        const nextModels = modelsResponse?.models ?? [];
        const nextUnifiedModel = unifiedResponse?.unified_model ?? null;
        const target = nextUnifiedModel?.default.primary;
        setModels(nextModels);
        setUnifiedModel(nextUnifiedModel);
        setSelectedModel(target?.model ?? nextModels[0]?.id ?? "");
        setRoutingChoice(target?.key ? "key" : "auto");
        setSelectedKey(target?.key ?? "");
      } catch (reason) {
        if (!cancelled) setError(errorMessage(reason));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [configPath, refreshToken]);

  const selectedModelDetails = models.find((model) => model.id === selectedModel);
  const enabledKeys = selectedModelDetails?.keys.filter((key) => key.enabled) ?? [];

  const chooseModel = (model: string) => {
    setSelectedModel(model);
    const nextModel = models.find((item) => item.id === model);
    const nextEnabledKeys = nextModel?.keys.filter((key) => key.enabled) ?? [];
    if (!nextEnabledKeys.some((key) => key.name === selectedKey)) {
      setSelectedKey(nextEnabledKeys[0]?.name ?? "");
    }
    if (routingChoice === "key" && nextEnabledKeys.length === 0) setRoutingChoice("auto");
  };

  const chooseRoutingChoice = (choice: RoutingChoice) => {
    setRoutingChoice(choice);
    if (choice === "key" && !selectedKey) setSelectedKey(enabledKeys[0]?.name ?? "");
  };

  const save = async () => {
    if (!selectedModel) {
      setError("请先选择模型。");
      return;
    }
    const key = routingChoice === "key" ? selectedKey || null : null;
    if (routingChoice === "key" && !key) {
      setError("当前模型没有可用的启用 Key。");
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const fallback = unifiedModel?.default.fallback?.model === selectedModel
        ? unifiedModel.default.primary
        : unifiedModel?.default.fallback ?? null;
      const nextDraft: AmkrUnifiedModel = {
        default: {
          primary: { model: selectedModel, key },
          fallback,
        },
        image: unifiedModel?.image ?? null,
      };
      const response = await updateAmkrUnifiedModel(nextDraft, configPath);
      const nextUnifiedModel = response?.unified_model ?? null;
      setUnifiedModel(nextUnifiedModel);
      const target = nextUnifiedModel?.default.primary;
      if (target) {
        setSelectedModel(target.model);
        setRoutingChoice(target.key ? "key" : "auto");
        setSelectedKey(target.key ?? "");
      }
      setNotice("统一模型已更新。");
      onChange?.(nextUnifiedModel);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setSaving(false);
    }
  };

  const disable = async () => {
    if (!window.confirm("停用统一模型后，统一入口将不再接管请求。是否继续？")) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await deleteAmkrUnifiedModel(configPath);
      setUnifiedModel(null);
      setNotice("统一模型已停用。");
      onChange?.(null);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="unified-model-panel" aria-labelledby="unified-model-panel-heading">
      <header className="card-heading">
        <div>
          <h3 id="unified-model-panel-heading">统一模型</h3>
          <p>选择默认文本模型及其路由方式。</p>
        </div>
        <span className={unifiedModel ? "status-good" : "status-muted"}>{statusLabel(unifiedModel)}</span>
      </header>
      {loading ? <p className="empty-state">正在读取统一模型配置。</p> : models.length === 0 ? <p className="empty-state">尚未配置可用模型。</p> : (
        <form className="unified-model-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
          <label>模型<select aria-label="模型" disabled={saving} value={selectedModel} onChange={(event) => chooseModel(event.target.value)}>
            {models.map((model) => <option key={model.id} value={model.id}>{model.id}</option>)}
          </select></label>
          <fieldset className="unified-model-mode">
            <legend>路由方式</legend>
            <label><input type="radio" name="unified-routing-choice" checked={routingChoice === "auto"} disabled={saving} onChange={() => chooseRoutingChoice("auto")} />自动路由</label>
            <label><input type="radio" name="unified-routing-choice" checked={routingChoice === "key"} disabled={saving || enabledKeys.length === 0} onChange={() => chooseRoutingChoice("key")} />固定 Key</label>
          </fieldset>
          {routingChoice === "key" ? <label>Key<select aria-label="Key" disabled={saving} value={selectedKey} onChange={(event) => setSelectedKey(event.target.value)}>
            {enabledKeys.map((key) => <option key={key.name} value={key.name}>{key.name}</option>)}
          </select></label> : null}
          <div className="row-actions">
            <button type="submit" disabled={saving || !selectedModel}>{saving ? "正在保存" : "保存统一模型"}</button>
            <button className="danger-button" type="button" disabled={saving || !unifiedModel} onClick={() => void disable()}>停用统一模型</button>
          </div>
        </form>
      )}
      {notice ? <p className="status-good" role="status">{notice}</p> : null}
      {error ? <p className="service-action-error" role="alert">统一模型操作失败: {error}</p> : null}
    </section>
  );
}
