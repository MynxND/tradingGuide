import { AuthGate } from './AuthGate';
import { TradingApp } from './TradingApp';

export default function Page() {
  return <AuthGate><TradingApp /></AuthGate>;
}
