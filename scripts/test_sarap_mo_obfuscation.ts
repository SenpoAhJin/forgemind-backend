/**
 * Test "sarap mo" obfuscation variants
 * 
 * Tests 3 obfuscation types against the phrase "sarap mo":
 * 1. Spaces: "s a r a p   m o"
 * 2. Punctuation: "sarap. mo", "sarap!mo", "sarap?mo"
 * 3. Mixed: "s.a.r.a.p m.o"
 * 
 * Reports which types are blocked by normalization.
 */

import { compileWord, containsTerm, toTarget } from '../src/moderation/normalize';

const PHRASE = 'sarap mo';

function testObfuscation() {
  console.log('=== Obfuscation Test: "sarap mo" ===\n');
  
  const compiled = compileWord(PHRASE);
  
  const variants = [
    // Type 1: Spaces
    { text: 's a r a p   m o', type: 'spaces' },
    { text: 's a r a p m o', type: 'spaces' },
    { text: 'sarap  mo', type: 'spaces' },
    
    // Type 2: Punctuation
    { text: 'sarap. mo', type: 'punctuation' },
    { text: 'sarap! mo', type: 'punctuation' },
    { text: 'sarap? mo', type: 'punctuation' },
    { text: 'sarap,mo', type: 'punctuation' },
    { text: 'sarap;mo', type: 'punctuation' },
    
    // Type 3: Mixed
    { text: 's.a.r.a.p m.o', type: 'mixed' },
    { text: 's a r a p. m o', type: 'mixed' },
    { text: 's,a,r,a,p m,o', type: 'mixed' },
  ];
  
  const blocked = {
    spaces: 0,
    punctuation: 0,
    mixed: 0,
  };
  
  const passed = {
    spaces: 0,
    punctuation: 0,
    mixed: 0,
  };
  
  console.log('Testing variants:\n');
  
  for (const variant of variants) {
    const target = toTarget(variant.text);
    const isBlocked = containsTerm(target, compiled);
    
    if (isBlocked) {
      console.log(`  ✅ BLOCKED: "${variant.text}" (${variant.type})`);
      blocked[variant.type as keyof typeof blocked]++;
    } else {
      console.log(`  ❌ PASSED: "${variant.text}" (${variant.type})`);
      passed[variant.type as keyof typeof passed]++;
    }
  }
  
  console.log('\n=== Summary by Type ===\n');
  
  const types: Array<keyof typeof blocked> = ['spaces', 'punctuation', 'mixed'];
  for (const type of types) {
    const total = blocked[type] + passed[type];
    const rate = total > 0 ? (blocked[type] / total) * 100 : 0;
    console.log(`${type}:`);
    console.log(`  Blocked: ${blocked[type]}/${total} (${rate.toFixed(0)}%)`);
    console.log(`  Passed: ${passed[type]}/${total}`);
    console.log();
  }
  
  const totalBlocked = blocked.spaces + blocked.punctuation + blocked.mixed;
  const totalPassed = passed.spaces + passed.punctuation + passed.mixed;
  const totalVariants = totalBlocked + totalPassed;
  const overallRate = totalVariants > 0 ? (totalBlocked / totalVariants) * 100 : 0;
  
  console.log('Overall:');
  console.log(`  Blocked: ${totalBlocked}/${totalVariants} (${overallRate.toFixed(0)}%)`);
  console.log(`  Passed: ${totalPassed}/${totalVariants}`);
}

testObfuscation();
