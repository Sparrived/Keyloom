import type { AmkrUnifiedModel } from "../../api/amkr";
import { UnifiedModelPanel } from "./UnifiedModelPanel";

type UnifiedModelPageProps = {
  configPath: string | null;
  onChange?: (unifiedModel: AmkrUnifiedModel | null) => void;
};

export function UnifiedModelPage({ configPath, onChange }: UnifiedModelPageProps) {
  return (
    <section className="unified-model-page" aria-labelledby="unified-model-page-heading">
      <header className="page-header">
        <div>
          <h2 id="unified-model-page-heading">统一模型</h2>
          <p>配置统一入口使用的主模型、回退目标、图像映射与推理强度。</p>
        </div>
      </header>
      <UnifiedModelPanel configPath={configPath} onChange={onChange} title="当前配置" />
    </section>
  );
}
