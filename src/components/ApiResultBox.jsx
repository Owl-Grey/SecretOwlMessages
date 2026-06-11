export default function ApiResultBox({ title = 'Result', value, error }) {
  return (
    <section className="panel">
      <h2>{title}</h2>
      <pre className={error ? 'result error' : 'result'}>
        {error ? String(error?.message || error) : value ? JSON.stringify(value, null, 2) : 'No result yet'}
      </pre>
    </section>
  );
}
