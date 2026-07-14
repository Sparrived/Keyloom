import { useEffect, useState } from "react";
import {
  deleteAmkrUnifiedModel,
  getAmkrModels,
  getAmkrUnifiedModel,
  updateAmkrModelReasoningEffort,
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
const reasoningEfforts = ["none", "minimal", "low", "medium", "high", "xhigh"] as const;

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
  const [reasoningEffort, setReasoningEffort] = useState("");
  const [fallbackModel, setFallbackModel] = useState("");
  const [fallbackKey, setFallbackKey] = useState("");
  const [imageModel, setImageModel] = useState("");
  const [imageKey, setImageKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
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
        const targetModel = nextModels.find((model) => model.id === (target?.model ?? nextModels[0]?.id));
        setModels(nextModels);
        setUnifiedModel(nextUnifiedModel);
        setSelectedModel(target?.model ?? nextModels[0]?.id ?? "");
        setRoutingChoice(target?.key ? "key" : "auto");
        setSelectedKey(target?.key ?? "");
        setReasoningEffort(targetModel?.reasoning_effort ?? "");
        setFallbackModel(nextUnifiedModel?.default.fallback?.model ?? "");
        setFallbackKey(nextUnifiedModel?.default.fallback?.key ?? "");
        setImageModel(nextUnifiedModel?.image?.primary.model ?? "");
        setImageKey(nextUnifiedModel?.image?.primary.key ?? "");
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
  const fallbackModelDetails = models.find((model) => model.id === fallbackModel);
  const fallbackKeys = fallbackModelDetails?.keys.filter((key) => key.enabled) ?? [];
  const imageModelDetails = models.find((model) => model.id === imageModel);
  const imageKeys = imageModelDetails?.keys.filter((key) => key.enabled) ?? [];

  const chooseModel = (model: string) => {
    if (fallbackModel === model && selectedModel && selectedModel !== model) {
      setFallbackModel(selectedModel);
      setFallbackKey(routingChoice === "key" ? selectedKey : "");
    }
    setSelectedModel(model);
    const nextModel = models.find((item) => item.id === model);
    const nextEnabledKeys = nextModel?.keys.filter((key) => key.enabled) ?? [];
    setReasoningEffort(nextModel?.reasoning_effort ?? "");
    if (!nextEnabledKeys.some((key) => key.name === selectedKey)) {
      setSelectedKey(nextEnabledKeys[0]?.name ?? "");
    }
    if (routingChoice === "key" && nextEnabledKeys.length === 0) setRoutingChoice("auto");
  };

  const chooseRoutingChoice = (choice: RoutingChoice) => {
    setRoutingChoice(choice);
    if (choice === "key" && !selectedKey) setSelectedKey(enabledKeys[0]?.name ?? "");
  };

  const cancelEditing = () => {
    const target = unifiedModel?.default.primary;
    const targetModel = models.find((model) => model.id === (target?.model ?? models[0]?.id));
    setSelectedModel(target?.model ?? models[0]?.id ?? "");
    setRoutingChoice(target?.key ? "key" : "auto");
    setSelectedKey(target?.key ?? "");
    setReasoningEffort(targetModel?.reasoning_effort ?? "");
    setFallbackModel(unifiedModel?.default.fallback?.model ?? "");
    setFallbackKey(unifiedModel?.default.fallback?.key ?? "");
    setImageModel(unifiedModel?.image?.primary.model ?? "");
    setImageKey(unifiedModel?.image?.primary.key ?? "");
    setError(null);
    setEditing(false);
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
    if (fallbackModel && fallbackModel === selectedModel) {
      setError("回退模型不能与主模型相同。");
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const fallback = fallbackModel
        ? { model: fallbackModel, key: fallbackKey || null }
        : null;
      const imageFallback = unifiedModel?.image?.fallback?.model === imageModel
        ? null
        : unifiedModel?.image?.fallback ?? null;
      const nextDraft: AmkrUnifiedModel = {
        default: {
          primary: { model: selectedModel, key },
          fallback,
        },
        image: unifiedModel?.image ?? null,
      };
      if (imageModel) {
        const imagePlan = imageFallback
          ? { primary: { model: imageModel, key: imageKey || null }, fallback: imageFallback }
          : { primary: { model: imageModel, key: imageKey || null } };
        nextDraft.image = imagePlan;
      } else {
        nextDraft.image = null;
      }
      const nextReasoningEffort = reasoningEffort || null;
      const currentReasoningEffort = selectedModelDetails?.reasoning_effort ?? null;
      let updatedModel: AmkrModel | null = null;
      if (selectedModelDetails && nextReasoningEffort !== currentReasoningEffort) {
        updatedModel = await updateAmkrModelReasoningEffort(selectedModel, nextReasoningEffort, configPath);
        setModels((current) => current.map((model) => model.id === updatedModel?.id ? updatedModel : model));
      }
      const response = await updateAmkrUnifiedModel(nextDraft, configPath);
      const nextUnifiedModel = response?.unified_model ?? null;
      setUnifiedModel(nextUnifiedModel);
      const target = nextUnifiedModel?.default.primary;
      if (target) {
        setSelectedModel(target.model);
        setRoutingChoice(target.key ? "key" : "auto");
        setSelectedKey(target.key ?? "");
        setReasoningEffort(updatedModel?.reasoning_effort ?? nextReasoningEffort ?? "");
      }
      setFallbackModel(nextUnifiedModel?.default.fallback?.model ?? "");
      setFallbackKey(nextUnifiedModel?.default.fallback?.key ?? "");
      setImageModel(nextUnifiedModel?.image?.primary.model ?? "");
      setImageKey(nextUnifiedModel?.image?.primary.key ?? "");
      setNotice("统一模型已更新。");
      setEditing(false);
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
      setEditing(false);
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
        <div className="unified-model-heading-actions">
          <span className={unifiedModel ? "status-good" : "status-muted"}>{unifiedModel ? "已启用" : "未启用"}</span>
          {!loading && models.length > 0 ? <button
            aria-controls="unified-model-editor"
            aria-expanded={editing}
            aria-label={editing ? "收起统一模型" : unifiedModel ? "编辑统一模型" : "配置统一模型"}
            className="secondary-button"
            type="button"
            onClick={() => editing ? cancelEditing() : setEditing(true)}
          >{editing ? "收起" : unifiedModel ? "编辑" : "配置"}</button> : null}
          {!editing && unifiedModel ? <button className="danger-button" type="button" disabled={saving} onClick={() => void disable()}>停用</button> : null}
        </div>
      </header>
      {loading ? <p className="empty-state">正在读取统一模型配置。</p> : models.length === 0 ? <p className="empty-state">尚未配置可用模型。</p> : !editing ? (
        <dl className="unified-model-overview">
          <div><dt>文本模型</dt><dd>{unifiedModel?.default.primary.model ?? "未配置"}</dd></div>
          <div><dt>路由方式</dt><dd>{statusLabel(unifiedModel)}</dd></div>
          <div><dt>回退模型</dt><dd>{unifiedModel?.default.fallback?.model ?? "未配置"}</dd></div>
          <div><dt>图像模型</dt><dd>{unifiedModel?.image?.primary.model ?? "未配置"}</dd></div>
        </dl>
      ) : (
        <form className="unified-model-form" id="unified-model-editor" onSubmit={(event) => { event.preventDefault(); void save(); }}>
          <div className="unified-model-primary">
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
          <label>推理强度<select aria-label="推理强度" disabled={saving} value={reasoningEffort} onChange={(event) => setReasoningEffort(event.target.value)}>
            <option value="">默认</option>
            {reasoningEfforts.map((effort) => <option key={effort} value={effort}>{effort}</option>)}
          </select></label>
          </div>
          {selectedModelDetails ? <div className="unified-model-summary" aria-label="模型能力">
            <span>路由策略：{selectedModelDetails.routing_mode}</span>
            <span>推理强度：{reasoningEffort || "默认"}</span>
            <span>{selectedModelDetails.visitor_available ? "访客可用" : "仅本地 Key"}</span>
            <span>启用 Key：{enabledKeys.length}</span>
            {selectedModelDetails.aliases.length ? <span>别名：{selectedModelDetails.aliases.join(", ")}</span> : null}
          </div> : null}
          <div className="unified-model-plans">
          <fieldset className="unified-model-plan">
            <legend>回退目标</legend>
            <label>回退模型<select aria-label="回退模型" disabled={saving} value={fallbackModel} onChange={(event) => { setFallbackModel(event.target.value); setFallbackKey(""); }}>
                <option value="">不启用回退</option>
                {models.filter((model) => model.id !== selectedModel).map((model) => <option key={model.id} value={model.id}>{model.id}</option>)}
              </select></label>
            <label>回退 Key<select aria-label="回退 Key" disabled={saving || !fallbackModel} value={fallbackKey} onChange={(event) => setFallbackKey(event.target.value)}>
                <option value="">自动路由</option>
                {fallbackKeys.map((key) => <option key={key.name} value={key.name}>{key.name}</option>)}
              </select></label>
          </fieldset>
          <fieldset className="unified-model-plan">
            <legend>图像模型映射</legend>
            <label>图像模型<select aria-label="图像模型" disabled={saving} value={imageModel} onChange={(event) => { setImageModel(event.target.value); setImageKey(""); }}>
                <option value="">不配置映射</option>
                {models.map((model) => <option key={model.id} value={model.id}>{model.id}</option>)}
              </select></label>
            <label>图像 Key<select aria-label="图像 Key" disabled={saving || !imageModel} value={imageKey} onChange={(event) => setImageKey(event.target.value)}>
                <option value="">自动路由</option>
                {imageKeys.map((key) => <option key={key.name} value={key.name}>{key.name}</option>)}
              </select></label>
          </fieldset>
          </div>
          <div className="form-actions">
            <button className="secondary-button" type="button" disabled={saving} onClick={cancelEditing}>取消</button>
            <button type="submit" disabled={saving || !selectedModel}>{saving ? "正在保存" : "保存统一模型"}</button>
          </div>
        </form>
      )}
      {notice ? <p className="status-good" role="status">{notice}</p> : null}
      {error ? <p className="service-action-error" role="alert">统一模型操作失败: {error}</p> : null}
    </section>
  );
}
