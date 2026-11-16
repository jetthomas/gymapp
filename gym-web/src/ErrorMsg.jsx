// The red error line under a form; renders nothing when there is no message
export default function ErrorMsg({ children }) {
  if (!children) return null;
  return (
    <p className="msg error" role="alert">
      {children}
    </p>
  );
}
