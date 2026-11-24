# VoteMirror: submission transaction evidence

Verified 2026-11-24T11:18:33.230Z. Run ID: submission-20261124-01.

All 8 scenarios ran on the current v4 deployment. The Base recovery sender was temporarily stopped for these tests and restored afterward. Optional Cron recovery remained off. All destination callbacks below target the configured Reactive callback proxy; direct owner transactions are labeled separately.

| Scenario | Threshold-reaching origin ballot | Lasna request | Base callback/result |
|---|---|---|---|
| For consensus | [bobVote](https://sepolia.basescan.org/tx/0xe1b5fcc7a1627f3120e933b892543e6f8f093c269a8b694cc551f2ee6fdf5af9) | [MirrorRequested](https://lasna.reactscan.net/tx/0xb6c6da5f177784e8929359d5bcf94f8ab00325ef906e8ab332e819aec3842257) | [Mirrored](https://sepolia.basescan.org/tx/0x07b2ec010d80ac53a863ed8a553ad181266205fa3628ee80d988e7c78e130294) |
| Against consensus | [bobVote](https://sepolia.basescan.org/tx/0x7693430be81f685883a425cab5307abc416d5794dd00ed50b0f341e33667dd6b) | [MirrorRequested](https://lasna.reactscan.net/tx/0x174d28009e1bf3ee0b63b9b0d0e1ab43a6a5afa90398f936cc4a300f0d056965) | [Mirrored](https://sepolia.basescan.org/tx/0x7ebb9612f10d26ebb3f110df0386c32146698770189bf1543778923d219c543a) |
| Abstain consensus | [bobVote](https://sepolia.basescan.org/tx/0xa2d14071cd2f1eeaa6d4bf7debe40af8c7be7ca545e70446802b53c18858f139) | [MirrorRequested](https://lasna.reactscan.net/tx/0xfe4e0753eccbe9382a9505f725e3b35653299fd0d4a9a0386fffbd6fee116302) | [Mirrored](https://sepolia.basescan.org/tx/0x46b68b950549fa770bb4599237cc1c24cdcbb9f9c917a9b525f3e0c21b113374) |
| Split, then majority | [carolVote](https://sepolia.basescan.org/tx/0x6d64ecc6155f6d079370a038e1dc497e77a95f754d825bef255ebf76a564a407) | [MirrorRequested](https://lasna.reactscan.net/tx/0x060e6f4945174dd0dae7c088f01ab1fcb34c6574a2aafc59784ae3730507a79f) | [Mirrored](https://sepolia.basescan.org/tx/0x5dca629a633059dec6773490e12104d0fa629d9f8f6b89cb83c4d989fb074bdb) |
| Owner skip | [bobVote](https://sepolia.basescan.org/tx/0x757b0020ebae638c59ec8c0a764a18f47953c10e4c1b45ae05bd24113ba77cc7) | [MirrorRequested](https://lasna.reactscan.net/tx/0x6b801cc9d067921d4dfc7c8f230e9c3bf82cb77974080e4e2dbe3e99c3eb16fc) | [Skipped](https://sepolia.basescan.org/tx/0x858ae3dc01f99f0836f993d4468d5605cfbe6551a3bf3fe6403d31f84cc40fde) |
| Paused, then Reactive retry | [bobVote](https://sepolia.basescan.org/tx/0x82f258feffba9a03ccb029c4e172c9fb782a30ca844c3721ed07cd12cc6d3408) | [MirrorRequested](https://lasna.reactscan.net/tx/0xf89dcf0e339e1b034bef13ad2915d71487649f1327b98f1318ca10f05a853852) / [MirrorRetried](https://lasna.reactscan.net/tx/0x33e8b01768cc18c2a1318388232622bdde67b342cb8bcb6470d9a278bea519df) | [Skipped](https://sepolia.basescan.org/tx/0x5e9004955f6d3dd3c31e9dfab7cc4f7f8ba3e26d1b5c698c4559d7bcac72edcf) / [Mirrored](https://sepolia.basescan.org/tx/0x701d248da8eb10ac7ff7d75d3cb7fc176c9682e53a16a65b2f82444544642de0) |
| Third ballot, no duplicate vote | [bobVote](https://sepolia.basescan.org/tx/0x6eb573a2659b101c7b290363565a382722dfa3ae5ee59241e4474e4b8b1f420c) | [MirrorRequested](https://lasna.reactscan.net/tx/0x341214ae035611819faaa3313710b908f260f21c061f237bcd062575e7e4df44) | [Mirrored](https://sepolia.basescan.org/tx/0xa7dc0f12749f2794c18b4afea9256722372ee502a788743c9f824bd5b6bf3c1e) |
| Owner vote takes priority | [bobVote](https://sepolia.basescan.org/tx/0xeb99b5eb8f48c5240d93204b566b03eeb66417f818cc2aa7f3df954b84dfe4d7) | [MirrorRequested](https://lasna.reactscan.net/tx/0xf3b3b4f1c6e536404459ea033ec62fd4722406b982550a050ed9504a83cc018e) | [Skipped](https://sepolia.basescan.org/tx/0x4ceb6bdac36cb70f9c2c043633ba4873d0f116e14f5171b442f55592122aef23) |

## Operational interruption and separate recovery

The original third-vote attempt encountered exhausted Reactive fee reserves. Its vote was subsequently recovered by the dedicated Base sender: [0xba401020d14156ed4b4e2748b4f6d969911aa42691311f5c372290cab2b8cd21](https://sepolia.basescan.org/tx/0xba401020d14156ed4b4e2748b4f6d969911aa42691311f5c372290cab2b8cd21). This is a direct recovery transaction and is excluded from the eight Reactive scenarios and nine proxy callbacks counted above. After [depositing 0.5 test lREACT](https://lasna.reactscan.net/tx/0x54b1270aec14597df7e9a86ad88ec4d7f174a8412864eebff13e636d5f024cba) to settle debt and replenish reserves, third-vote and owner-override cases ran with fresh proposal IDs. The original incomplete attempt remains recorded in deployments/v4-thirdvote-submission-20261124-01.json.

## Complete transaction hashes

### For consensus

Proposal ID: `36228937224938343754827479087973957791250278039029893122434504547942826949354`. [Raw scenario](../deployments/v4-for-submission-20261124-01.json).

- Proposal creation: [0xfb164a6f127ede5ae963edaf5417c6953b5bf5bf5078888ed832da34397d1cee](https://sepolia.basescan.org/tx/0xfb164a6f127ede5ae963edaf5417c6953b5bf5bf5078888ed832da34397d1cee)
- aliceVote (For): [0xbffbd5a107b852da88f7dfd7b1f76ae92d879e7d3d53af3363fece019b0a0d6d](https://sepolia.basescan.org/tx/0xbffbd5a107b852da88f7dfd7b1f76ae92d879e7d3d53af3363fece019b0a0d6d); matching Lasna notification: [0x9408f2b0e100797d196260980fb03d00ef757e0a0eaf0092843799c957210f66](https://lasna.reactscan.net/tx/0x9408f2b0e100797d196260980fb03d00ef757e0a0eaf0092843799c957210f66)
- bobVote (For): [0xe1b5fcc7a1627f3120e933b892543e6f8f093c269a8b694cc551f2ee6fdf5af9](https://sepolia.basescan.org/tx/0xe1b5fcc7a1627f3120e933b892543e6f8f093c269a8b694cc551f2ee6fdf5af9); matching Lasna notification: [0xb6c6da5f177784e8929359d5bcf94f8ab00325ef906e8ab332e819aec3842257](https://lasna.reactscan.net/tx/0xb6c6da5f177784e8929359d5bcf94f8ab00325ef906e8ab332e819aec3842257)
- MirrorRequested: [0xb6c6da5f177784e8929359d5bcf94f8ab00325ef906e8ab332e819aec3842257](https://lasna.reactscan.net/tx/0xb6c6da5f177784e8929359d5bcf94f8ab00325ef906e8ab332e819aec3842257)
- Proxy callback Mirrored: [0x07b2ec010d80ac53a863ed8a553ad181266205fa3628ee80d988e7c78e130294](https://sepolia.basescan.org/tx/0x07b2ec010d80ac53a863ed8a553ad181266205fa3628ee80d988e7c78e130294)

Final Governor totals (Against / For / Abstain, raw 18-decimal VMD): 0 / 3000000000000000000000 / 0.

### Against consensus

Proposal ID: `22706991438215472360876397359231988165928698799516574737441836676777693021771`. [Raw scenario](../deployments/v4-against-submission-20261124-01.json).

- Proposal creation: [0xc29734f053461bbf0bf1acc691fac2fd0d4ebe6b3f71f10915292bfdea7a8082](https://sepolia.basescan.org/tx/0xc29734f053461bbf0bf1acc691fac2fd0d4ebe6b3f71f10915292bfdea7a8082)
- aliceVote (Against): [0x5eb637031cabedf677ec6a9bffe047bcacb705d907bf11da12ea3888379c408e](https://sepolia.basescan.org/tx/0x5eb637031cabedf677ec6a9bffe047bcacb705d907bf11da12ea3888379c408e); matching Lasna notification: [0x89a23315c81012b2e3eeec3027e6228ca69be4c228188e94bb943950a1d9894c](https://lasna.reactscan.net/tx/0x89a23315c81012b2e3eeec3027e6228ca69be4c228188e94bb943950a1d9894c)
- bobVote (Against): [0x7693430be81f685883a425cab5307abc416d5794dd00ed50b0f341e33667dd6b](https://sepolia.basescan.org/tx/0x7693430be81f685883a425cab5307abc416d5794dd00ed50b0f341e33667dd6b); matching Lasna notification: [0x174d28009e1bf3ee0b63b9b0d0e1ab43a6a5afa90398f936cc4a300f0d056965](https://lasna.reactscan.net/tx/0x174d28009e1bf3ee0b63b9b0d0e1ab43a6a5afa90398f936cc4a300f0d056965)
- MirrorRequested: [0x174d28009e1bf3ee0b63b9b0d0e1ab43a6a5afa90398f936cc4a300f0d056965](https://lasna.reactscan.net/tx/0x174d28009e1bf3ee0b63b9b0d0e1ab43a6a5afa90398f936cc4a300f0d056965)
- Proxy callback Mirrored: [0x7ebb9612f10d26ebb3f110df0386c32146698770189bf1543778923d219c543a](https://sepolia.basescan.org/tx/0x7ebb9612f10d26ebb3f110df0386c32146698770189bf1543778923d219c543a)

Final Governor totals (Against / For / Abstain, raw 18-decimal VMD): 3000000000000000000000 / 0 / 0.

### Abstain consensus

Proposal ID: `8778562821097296194814712495110370344560291553479725354752080596203352768197`. [Raw scenario](../deployments/v4-abstain-submission-20261124-01.json).

- Proposal creation: [0xc1856c48a714c890760a313ee32a4514c8b17515d7ead84704488e242369f9bc](https://sepolia.basescan.org/tx/0xc1856c48a714c890760a313ee32a4514c8b17515d7ead84704488e242369f9bc)
- aliceVote (Abstain): [0x6486faa33b24060751ad12511e7c6053753f0667a990dc6c80b00b6905b3b7d8](https://sepolia.basescan.org/tx/0x6486faa33b24060751ad12511e7c6053753f0667a990dc6c80b00b6905b3b7d8); matching Lasna notification: [0xf8bd4fd9c28a4298244732707904cc7363a769771c5f12462a060999b3934c42](https://lasna.reactscan.net/tx/0xf8bd4fd9c28a4298244732707904cc7363a769771c5f12462a060999b3934c42)
- bobVote (Abstain): [0xa2d14071cd2f1eeaa6d4bf7debe40af8c7be7ca545e70446802b53c18858f139](https://sepolia.basescan.org/tx/0xa2d14071cd2f1eeaa6d4bf7debe40af8c7be7ca545e70446802b53c18858f139); matching Lasna notification: [0xfe4e0753eccbe9382a9505f725e3b35653299fd0d4a9a0386fffbd6fee116302](https://lasna.reactscan.net/tx/0xfe4e0753eccbe9382a9505f725e3b35653299fd0d4a9a0386fffbd6fee116302)
- MirrorRequested: [0xfe4e0753eccbe9382a9505f725e3b35653299fd0d4a9a0386fffbd6fee116302](https://lasna.reactscan.net/tx/0xfe4e0753eccbe9382a9505f725e3b35653299fd0d4a9a0386fffbd6fee116302)
- Proxy callback Mirrored: [0x46b68b950549fa770bb4599237cc1c24cdcbb9f9c917a9b525f3e0c21b113374](https://sepolia.basescan.org/tx/0x46b68b950549fa770bb4599237cc1c24cdcbb9f9c917a9b525f3e0c21b113374)

Final Governor totals (Against / For / Abstain, raw 18-decimal VMD): 0 / 0 / 3000000000000000000000.

### Split, then majority

Proposal ID: `99120689870109209166797952185301981273289501946958317610033082514278182515334`. [Raw scenario](../deployments/v4-splitmajority-submission-20261124-01.json).

- Proposal creation: [0x30871962f7e0582a3dcbf4a8de429784795f322c0bcb96bf390443617599524c](https://sepolia.basescan.org/tx/0x30871962f7e0582a3dcbf4a8de429784795f322c0bcb96bf390443617599524c)
- aliceVote (For): [0xb22557805b8cf74aceef30ea4da9a91a257cee4e13d486ad1c59e11625db8b78](https://sepolia.basescan.org/tx/0xb22557805b8cf74aceef30ea4da9a91a257cee4e13d486ad1c59e11625db8b78); matching Lasna notification: [0x2d6649e066c4c43d14b232bce012a5be253769e3c77ee1b33163e24b8209eaa7](https://lasna.reactscan.net/tx/0x2d6649e066c4c43d14b232bce012a5be253769e3c77ee1b33163e24b8209eaa7)
- bobVote (Against): [0xd1dc92087fa27097fe6c0d776a7614841606d127064a47dabe528116315d1bb1](https://sepolia.basescan.org/tx/0xd1dc92087fa27097fe6c0d776a7614841606d127064a47dabe528116315d1bb1); matching Lasna notification: [0x9d635fc07801914ddb42a3cda228f551dd9b8a057853ce66459a0db64586170d](https://lasna.reactscan.net/tx/0x9d635fc07801914ddb42a3cda228f551dd9b8a057853ce66459a0db64586170d)
- carolVote (For): [0x6d64ecc6155f6d079370a038e1dc497e77a95f754d825bef255ebf76a564a407](https://sepolia.basescan.org/tx/0x6d64ecc6155f6d079370a038e1dc497e77a95f754d825bef255ebf76a564a407); matching Lasna notification: [0x060e6f4945174dd0dae7c088f01ab1fcb34c6574a2aafc59784ae3730507a79f](https://lasna.reactscan.net/tx/0x060e6f4945174dd0dae7c088f01ab1fcb34c6574a2aafc59784ae3730507a79f)
- MirrorRequested: [0x060e6f4945174dd0dae7c088f01ab1fcb34c6574a2aafc59784ae3730507a79f](https://lasna.reactscan.net/tx/0x060e6f4945174dd0dae7c088f01ab1fcb34c6574a2aafc59784ae3730507a79f)
- Proxy callback Mirrored: [0x5dca629a633059dec6773490e12104d0fa629d9f8f6b89cb83c4d989fb074bdb](https://sepolia.basescan.org/tx/0x5dca629a633059dec6773490e12104d0fa629d9f8f6b89cb83c4d989fb074bdb)

Final Governor totals (Against / For / Abstain, raw 18-decimal VMD): 1000000000000000000000 / 3000000000000000000000 / 0.

### Owner skip

Proposal ID: `4659687604655985853164005417523156934026204605243082917279522195445723932`. [Raw scenario](../deployments/v4-skip-submission-20261124-01.json).

- Proposal creation: [0x5cd7be260ae503337d923b2f5e9cedaf79e733638425715b8d0f695edebef7eb](https://sepolia.basescan.org/tx/0x5cd7be260ae503337d923b2f5e9cedaf79e733638425715b8d0f695edebef7eb)
- aliceVote (For): [0xf7d0bb2f9c3be21ff31d0d682f10f5abf6db41d51ef563ec909c26f23b585f01](https://sepolia.basescan.org/tx/0xf7d0bb2f9c3be21ff31d0d682f10f5abf6db41d51ef563ec909c26f23b585f01); matching Lasna notification: [0x70854247581533b66c5609d14d32620edd1284d1a97adcaf38357e467bb9a227](https://lasna.reactscan.net/tx/0x70854247581533b66c5609d14d32620edd1284d1a97adcaf38357e467bb9a227)
- bobVote (For): [0x757b0020ebae638c59ec8c0a764a18f47953c10e4c1b45ae05bd24113ba77cc7](https://sepolia.basescan.org/tx/0x757b0020ebae638c59ec8c0a764a18f47953c10e4c1b45ae05bd24113ba77cc7); matching Lasna notification: [0x6b801cc9d067921d4dfc7c8f230e9c3bf82cb77974080e4e2dbe3e99c3eb16fc](https://lasna.reactscan.net/tx/0x6b801cc9d067921d4dfc7c8f230e9c3bf82cb77974080e4e2dbe3e99c3eb16fc)
- MirrorRequested: [0x6b801cc9d067921d4dfc7c8f230e9c3bf82cb77974080e4e2dbe3e99c3eb16fc](https://lasna.reactscan.net/tx/0x6b801cc9d067921d4dfc7c8f230e9c3bf82cb77974080e4e2dbe3e99c3eb16fc)
- Proxy callback Skipped (reason 1): [0x858ae3dc01f99f0836f993d4468d5605cfbe6551a3bf3fe6403d31f84cc40fde](https://sepolia.basescan.org/tx/0x858ae3dc01f99f0836f993d4468d5605cfbe6551a3bf3fe6403d31f84cc40fde)

Final Governor totals (Against / For / Abstain, raw 18-decimal VMD): 0 / 2000000000000000000000 / 0.

### Paused, then Reactive retry

Proposal ID: `100044930948447221512871333447436801271690687714990617753066998304396183612091`. [Raw scenario](../deployments/v4-retry-submission-20261124-01.json).

- Proposal creation: [0xc300d1d48fc1bac7e8dbb53604c65d589371b98681a015bb72168b265b43e19b](https://sepolia.basescan.org/tx/0xc300d1d48fc1bac7e8dbb53604c65d589371b98681a015bb72168b265b43e19b)
- aliceVote (For): [0x339a5465545c3241954a5a0c95b4eae2e02c62ea35ba3562f7ef01c6a23f36b2](https://sepolia.basescan.org/tx/0x339a5465545c3241954a5a0c95b4eae2e02c62ea35ba3562f7ef01c6a23f36b2); matching Lasna notification: [0xb66c039e3a60f874e9f0cd0b8a866bdda2dcc54acab9ea9ba05329490ae8d86b](https://lasna.reactscan.net/tx/0xb66c039e3a60f874e9f0cd0b8a866bdda2dcc54acab9ea9ba05329490ae8d86b)
- bobVote (For): [0x82f258feffba9a03ccb029c4e172c9fb782a30ca844c3721ed07cd12cc6d3408](https://sepolia.basescan.org/tx/0x82f258feffba9a03ccb029c4e172c9fb782a30ca844c3721ed07cd12cc6d3408); matching Lasna notification: [0xf89dcf0e339e1b034bef13ad2915d71487649f1327b98f1318ca10f05a853852](https://lasna.reactscan.net/tx/0xf89dcf0e339e1b034bef13ad2915d71487649f1327b98f1318ca10f05a853852)
- MirrorRequested: [0xf89dcf0e339e1b034bef13ad2915d71487649f1327b98f1318ca10f05a853852](https://lasna.reactscan.net/tx/0xf89dcf0e339e1b034bef13ad2915d71487649f1327b98f1318ca10f05a853852)
- MirrorRetried: [0x33e8b01768cc18c2a1318388232622bdde67b342cb8bcb6470d9a278bea519df](https://lasna.reactscan.net/tx/0x33e8b01768cc18c2a1318388232622bdde67b342cb8bcb6470d9a278bea519df)
- Proxy callback Skipped (reason 0): [0x5e9004955f6d3dd3c31e9dfab7cc4f7f8ba3e26d1b5c698c4559d7bcac72edcf](https://sepolia.basescan.org/tx/0x5e9004955f6d3dd3c31e9dfab7cc4f7f8ba3e26d1b5c698c4559d7bcac72edcf)
- Proxy callback Mirrored: [0x701d248da8eb10ac7ff7d75d3cb7fc176c9682e53a16a65b2f82444544642de0](https://sepolia.basescan.org/tx/0x701d248da8eb10ac7ff7d75d3cb7fc176c9682e53a16a65b2f82444544642de0)

Final Governor totals (Against / For / Abstain, raw 18-decimal VMD): 0 / 3000000000000000000000 / 0.

### Third ballot, no duplicate vote

Proposal ID: `20045268361807965263975781613079352145030377677362195621491887852228068547988`. [Raw scenario](../deployments/v4-thirdvote-submission-20261124-02.json).

- Proposal creation: [0x395bfdf919830384e29ca372af446472403da89a42be6a0872018a1ce62bfe20](https://sepolia.basescan.org/tx/0x395bfdf919830384e29ca372af446472403da89a42be6a0872018a1ce62bfe20)
- aliceVote (For): [0xe5a4fa1e767c2fdbd7892a4ad37f258ae49a2571e655c3881080950ec8632234](https://sepolia.basescan.org/tx/0xe5a4fa1e767c2fdbd7892a4ad37f258ae49a2571e655c3881080950ec8632234); matching Lasna notification: [0xf3a2edafac18ba5e466b9d498270ce7512487dd1ce133994edcd835532d95fbb](https://lasna.reactscan.net/tx/0xf3a2edafac18ba5e466b9d498270ce7512487dd1ce133994edcd835532d95fbb)
- bobVote (For): [0x6eb573a2659b101c7b290363565a382722dfa3ae5ee59241e4474e4b8b1f420c](https://sepolia.basescan.org/tx/0x6eb573a2659b101c7b290363565a382722dfa3ae5ee59241e4474e4b8b1f420c); matching Lasna notification: [0x341214ae035611819faaa3313710b908f260f21c061f237bcd062575e7e4df44](https://lasna.reactscan.net/tx/0x341214ae035611819faaa3313710b908f260f21c061f237bcd062575e7e4df44)
- carolVote (For): [0xc6b6ed0e476dedaa53fa16e86389d29f532a4d9336e5a6cdd3d868f54d39154b](https://sepolia.basescan.org/tx/0xc6b6ed0e476dedaa53fa16e86389d29f532a4d9336e5a6cdd3d868f54d39154b); matching Lasna notification: [0x1df4b43e4e6887ae459e1da7f7b20b00f4880aa0744f64f805ce0d6c6a325c48](https://lasna.reactscan.net/tx/0x1df4b43e4e6887ae459e1da7f7b20b00f4880aa0744f64f805ce0d6c6a325c48)
- MirrorRequested: [0x341214ae035611819faaa3313710b908f260f21c061f237bcd062575e7e4df44](https://lasna.reactscan.net/tx/0x341214ae035611819faaa3313710b908f260f21c061f237bcd062575e7e4df44)
- Proxy callback Mirrored: [0xa7dc0f12749f2794c18b4afea9256722372ee502a788743c9f824bd5b6bf3c1e](https://sepolia.basescan.org/tx/0xa7dc0f12749f2794c18b4afea9256722372ee502a788743c9f824bd5b6bf3c1e)

Final Governor totals (Against / For / Abstain, raw 18-decimal VMD): 0 / 4000000000000000000000 / 0.

### Owner vote takes priority

Proposal ID: `83134981177055261194368835372367993550427359025045203210467263787267451031111`. [Raw scenario](../deployments/v4-owneroverride-submission-20261124-02.json).

- Proposal creation: [0x5e5c836ae1ca0449800076b873bf0eeb7335c4d51695c8e93ea610a810dd57a7](https://sepolia.basescan.org/tx/0x5e5c836ae1ca0449800076b873bf0eeb7335c4d51695c8e93ea610a810dd57a7)
- aliceVote (For): [0x9b82d0f41ce07505a8d1ac7cb884a3ad37cd3c1ea1f432c447f06257b8810815](https://sepolia.basescan.org/tx/0x9b82d0f41ce07505a8d1ac7cb884a3ad37cd3c1ea1f432c447f06257b8810815); matching Lasna notification: [0xa1558cc9e91444fc18788a8ba0cab0d1c082a71e352ce55926269b9f9a431f67](https://lasna.reactscan.net/tx/0xa1558cc9e91444fc18788a8ba0cab0d1c082a71e352ce55926269b9f9a431f67)
- bobVote (For): [0xeb99b5eb8f48c5240d93204b566b03eeb66417f818cc2aa7f3df954b84dfe4d7](https://sepolia.basescan.org/tx/0xeb99b5eb8f48c5240d93204b566b03eeb66417f818cc2aa7f3df954b84dfe4d7); matching Lasna notification: [0xf3b3b4f1c6e536404459ea033ec62fd4722406b982550a050ed9504a83cc018e](https://lasna.reactscan.net/tx/0xf3b3b4f1c6e536404459ea033ec62fd4722406b982550a050ed9504a83cc018e)
- MirrorRequested: [0xf3b3b4f1c6e536404459ea033ec62fd4722406b982550a050ed9504a83cc018e](https://lasna.reactscan.net/tx/0xf3b3b4f1c6e536404459ea033ec62fd4722406b982550a050ed9504a83cc018e)
- Proxy callback Skipped (reason 2): [0x4ceb6bdac36cb70f9c2c043633ba4873d0f116e14f5171b442f55592122aef23](https://sepolia.basescan.org/tx/0x4ceb6bdac36cb70f9c2c043633ba4873d0f116e14f5171b442f55592122aef23)
- Owner's earlier direct Against vote (not a Reactive callback): [0x2aa437cdb16356d578594fa0fb32f0959f487d1a6e1cbcb949b147e0d860f309](https://sepolia.basescan.org/tx/0x2aa437cdb16356d578594fa0fb32f0959f487d1a6e1cbcb949b147e0d860f309)

Final Governor totals (Against / For / Abstain, raw 18-decimal VMD): 1000000000000000000000 / 2000000000000000000000 / 0.

## Verification scope

- Successful canonical receipts with at least two additional blocks on both chains.
- Origin VoteCast sender, proposal ID, support and weight.
- Every observed origin transaction hash, block hash, log index, topics and data matched the decoded Lasna system notification payload. The ABI payload was re-encoded byte for byte.
- MirrorRequested / MirrorRetried matched the proposal, support and threshold.
- Destination transactions targeted the configured callback proxy, and emitted the expected VoteMirror Mirrored / Skipped event. Successful mirrored votes also emitted the Governor VoteCast for VoteMirror.
- Governor vote totals and hasVoted were read back; split-before-majority was checked at its historical Base block.
- Six scenarios mirrored a vote; skip and owner override intentionally prevented a new mirrored vote. Retry contains both a skipped callback and a successful callback.
- Third-vote idempotency is demonstrated through the verification block, not a claim about arbitrary future network behavior.
- No latency SLA or continuous uptime is claimed. All tokens and fees are testnet-only.

Machine-readable proof: [submission-evidence-submission-20261124-01.json](../deployments/submission-evidence-submission-20261124-01.json). Scenario paths are indexed in [evidence-suite-submission-20261124-01.json](../deployments/evidence-suite-submission-20261124-01.json).
