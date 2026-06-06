import { MarkdownPage } from '../components/MarkdownPage';
import { PRIVACY_MD } from '../lib/legalText';

export default function PrivacyScreen() {
  return <MarkdownPage title="개인정보 처리방침" markdown={PRIVACY_MD} />;
}
