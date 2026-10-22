type ContainerProps = {
  children: React.ReactNode;
  className?: string;
};

export default function Container({ children, className = '' }: ContainerProps) {
  return <div className={`mx-auto w-full max-w-content px-4 ${className}`}>{children}</div>;
}
