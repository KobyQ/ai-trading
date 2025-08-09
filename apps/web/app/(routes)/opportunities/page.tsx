import Link from 'next/link';
export default function Page(){
  return (
    <div>
      <h2>Opportunities</h2>
      <p>List of research-created trade opportunities with AI summaries.</p>
      <ul>
        <li><Link href="/opportunities?id=sample">Sample Opportunity</Link></li>
      </ul>
    </div>
  );
}
