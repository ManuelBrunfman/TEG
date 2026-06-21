export function Coat({ small = false }: { small?: boolean }) {
  return (
    <div className={`coat ${small ? "coat--small" : ""}`} aria-hidden="true">
      <span>♜</span>
    </div>
  );
}
