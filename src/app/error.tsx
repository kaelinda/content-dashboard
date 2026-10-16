"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="fatal">
      <h1>工作台暂时没有准备好</h1>
      <p>你的持久化内容不受此页面错误影响。请重试，或检查服务日志。</p>
      <button onClick={reset}>重新加载</button>
    </main>
  );
}
